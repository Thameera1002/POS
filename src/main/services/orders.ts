import { getDb } from '../db'
import { getSettings } from './settings'
import { printKitchenTickets, printVoidTickets, printReceipt } from '../printing/service'
import type {
  AddItemInput,
  AddPaymentInput,
  CreateOrderInput,
  MenuItem,
  Modifier,
  Order,
  OrderFilter,
  OrderItem,
  OrderItemModifier,
  OrderSummary,
  OrderTotals,
  Payment,
  PrintResult,
  UpdateItemInput
} from '../../shared/types'

/* ---------- reads ---------- */

export function getOrder(id: number): Order {
  const db = getDb()

  const row = db
    .prepare(
      `SELECT o.*, t.name AS table_name FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id WHERE o.id = ?`
    )
    .get(id) as (Omit<Order, 'items' | 'payments' | 'totals'> & { table_name: string | null }) | undefined

  if (!row) throw new Error(`Order ${id} not found`)

  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
    .all(id) as Omit<OrderItem, 'modifiers'>[]

  const mods = db
    .prepare(
      `SELECT m.* FROM order_item_modifiers m
       JOIN order_items i ON i.id = m.order_item_id WHERE i.order_id = ? ORDER BY m.id`
    )
    .all(id) as OrderItemModifier[]

  const modsByItem = new Map<number, OrderItemModifier[]>()
  for (const m of mods) {
    const bucket = modsByItem.get(m.order_item_id)
    bucket ? bucket.push(m) : modsByItem.set(m.order_item_id, [m])
  }

  const payments = db
    .prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id')
    .all(id) as Payment[]

  const hydrated: OrderItem[] = items.map((i) => ({ ...i, modifiers: modsByItem.get(i.id) ?? [] }))
  const order = { ...row, items: hydrated, payments } as Order
  order.totals = computeTotals(order)
  return order
}

export function listOpenOrders(): OrderSummary[] {
  return listOrders('open')
}

/**
 * The transactions view.
 *
 * A takeaway order never appears on the floor plan, so this is how it stays
 * traceable: filter by type, status and date, or search a customer's phone
 * number when they ring back about an order they placed an hour ago.
 */
export function searchOrders(filter: OrderFilter = {}): OrderSummary[] {
  const where: string[] = []
  const args: unknown[] = []

  if (filter.status && filter.status !== 'all') {
    where.push('o.status = ?')
    args.push(filter.status)
  }
  if (filter.order_type && filter.order_type !== 'all') {
    where.push('o.order_type = ?')
    args.push(filter.order_type)
  }
  if (filter.from) {
    where.push('COALESCE(o.closed_at, o.opened_at) >= ?')
    args.push(`${filter.from} 00:00:00`)
  }
  if (filter.to) {
    where.push('COALESCE(o.closed_at, o.opened_at) <= ?')
    args.push(`${filter.to} 23:59:59`)
  }
  if (filter.query?.trim()) {
    const q = filter.query.trim()
    where.push(
      '(CAST(o.order_number AS TEXT) LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)'
    )
    args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }

  const rows = getDb()
    .prepare(
      `SELECT o.id, o.order_number, o.order_type, t.name AS table_name, o.guest_count,
              o.status, o.opened_at, o.closed_at, o.customer_name, o.customer_phone,
              COALESCE(SUM(CASE WHEN i.status != 'voided' THEN i.qty ELSE 0 END), 0) AS item_count,
              MAX(CASE WHEN i.status = 'pending' THEN 1 ELSE 0 END) AS has_unsent
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN order_items i ON i.order_id = o.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY o.id
       ORDER BY o.id DESC
       LIMIT ?`
    )
    .all(...args, Math.min(filter.limit ?? 200, 500)) as (Omit<OrderSummary, 'total_cents'> & {
    has_unsent: number | null
  })[]

  return rows.map((r) => ({
    ...r,
    has_unsent: r.has_unsent ?? 0,
    total_cents: computeTotals(getOrder(r.id)).total_cents
  }))
}

export function listOrders(status?: 'open' | 'paid' | 'void'): OrderSummary[] {
  const where = status ? 'WHERE o.status = ?' : ''
  const rows = getDb()
    .prepare(
      `SELECT o.id, o.order_number, o.order_type, t.name AS table_name, o.guest_count,
              o.status, o.opened_at, o.closed_at,
              COALESCE(SUM(CASE WHEN i.status != 'voided' THEN i.qty ELSE 0 END), 0) AS item_count,
              MAX(CASE WHEN i.status = 'pending' THEN 1 ELSE 0 END) AS has_unsent
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN order_items i ON i.order_id = o.id
       ${where}
       GROUP BY o.id
       ORDER BY o.id DESC
       LIMIT 200`
    )
    .all(...(status ? [status] : [])) as (Omit<OrderSummary, 'total_cents'> & {
    has_unsent: number | null
  })[]

  // Totals depend on per-item tax flags and order-level percentages, so they are
  // derived from the same function the receipt uses rather than re-implemented
  // in SQL — one source of truth for money.
  return rows.map((r) => ({
    ...r,
    has_unsent: r.has_unsent ?? 0,
    total_cents: computeTotals(getOrder(r.id)).total_cents
  }))
}

/* ---------- totals ---------- */

/**
 * The single authoritative money calculation.
 *
 * Order of operations, which is what auditors and tax authorities care about:
 *   subtotal        = sum of non-voided line totals
 *   discount        = subtotal x discount%
 *   service charge  = (subtotal - discount) x service%
 *   tax             = (subtotal - discount + service) x taxable-share x tax%
 *   total           = subtotal - discount + service + tax
 *
 * `taxable-share` prorates tax when the check mixes taxable and exempt items,
 * so an exempt item is not taxed through the service charge by the back door.
 * All arithmetic is integer cents; rounding happens once per component.
 */
export function computeTotals(order: Pick<Order, 'items' | 'payments' | 'discount_pct' | 'service_charge_pct' | 'tax_pct'>): OrderTotals {
  const live = order.items.filter((i) => i.status !== 'voided')

  const subtotal = live.reduce((n, i) => n + i.line_total_cents, 0)
  const taxableSubtotal = live.reduce((n, i) => n + (i.taxable ? i.line_total_cents : 0), 0)

  const discount = Math.round((subtotal * order.discount_pct) / 100)
  const afterDiscount = subtotal - discount
  const service = Math.round((afterDiscount * order.service_charge_pct) / 100)

  const taxableShare = subtotal > 0 ? taxableSubtotal / subtotal : 0
  const tax = Math.round(((afterDiscount + service) * taxableShare * order.tax_pct) / 100)

  const total = afterDiscount + service + tax
  const paid = order.payments.reduce((n, p) => n + p.amount_cents, 0)

  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    service_charge_cents: service,
    tax_cents: tax,
    total_cents: total,
    paid_cents: paid,
    due_cents: Math.max(0, total - paid)
  }
}

/* ---------- order lifecycle ---------- */

export function createOrder(input: CreateOrderInput): Order {
  const db = getDb()
  const settings = getSettings()

  return db.transaction(() => {
    if (input.order_type === 'dine_in' && input.table_id) {
      const busy = db
        .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'open'")
        .get(input.table_id) as { id: number } | undefined
      // Reopening the existing check is what a server actually wants when they
      // tap an occupied table — not a second check on the same table.
      if (busy) return getOrder(busy.id)
    }

    const orderNumber = nextOrderNumber(db)

    const id = Number(
      db
        .prepare(
          `INSERT INTO orders (order_number, order_type, table_id, guest_count, customer_name,
             customer_phone, note, tax_pct, service_charge_pct)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orderNumber,
          input.order_type,
          input.table_id ?? null,
          input.guest_count ?? 1,
          input.customer_name ?? null,
          input.customer_phone ?? null,
          input.note?.trim() || null,
          settings.tax_pct,
          // Service charge is a dine-in convention; charging it on a takeaway
          // bag is the kind of thing customers notice.
          input.order_type === 'dine_in' ? settings.service_charge_pct : 0
        ).lastInsertRowid
    )

    return getOrder(id)
  })()
}

/** Per-day sequence, so staff say "order forty-two", not "order 10417". */
function nextOrderNumber(db: ReturnType<typeof getDb>): number {
  const day = new Date().toISOString().slice(0, 10)
  db.prepare('INSERT OR IGNORE INTO order_counters (day, last) VALUES (?, 0)').run(day)
  db.prepare('UPDATE order_counters SET last = last + 1 WHERE day = ?').run(day)
  const row = db.prepare('SELECT last FROM order_counters WHERE day = ?').get(day) as {
    last: number
  }
  return row.last
}

export function updateOrder(
  id: number,
  patch: Partial<
    Pick<
      Order,
      | 'order_type'
      | 'table_id'
      | 'guest_count'
      | 'customer_name'
      | 'customer_phone'
      | 'discount_pct'
      | 'service_charge_pct'
      | 'tax_pct'
      | 'note'
    >
  >
): Order {
  const db = getDb()
  const current = getOrder(id)
  assertOpen(current)

  const next = { ...current, ...patch }
  if (next.discount_pct < 0 || next.discount_pct > 100) {
    throw new Error('Discount must be between 0 and 100 percent')
  }

  db.prepare(
    `UPDATE orders SET order_type=@order_type, table_id=@table_id, guest_count=@guest_count,
       customer_name=@customer_name, customer_phone=@customer_phone, discount_pct=@discount_pct,
       service_charge_pct=@service_charge_pct, tax_pct=@tax_pct, note=@note
     WHERE id=@id`
  ).run({
    order_type: next.order_type,
    table_id: next.table_id,
    guest_count: next.guest_count,
    customer_name: next.customer_name,
    customer_phone: next.customer_phone,
    discount_pct: next.discount_pct,
    service_charge_pct: next.service_charge_pct,
    tax_pct: next.tax_pct,
    note: next.note,
    id
  })

  return getOrder(id)
}

/* ---------- line items ---------- */

export function addItem(input: AddItemInput): Order {
  const db = getDb()

  db.transaction(() => {
    const order = getOrder(input.order_id)
    assertOpen(order)

    if (input.qty <= 0) throw new Error('Quantity must be at least 1')

    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(input.menu_item_id) as
      | MenuItem
      | undefined
    if (!item) throw new Error(`Menu item ${input.menu_item_id} not found`)

    const mods = (input.modifier_ids ?? []).length
      ? (db
          .prepare(
            `SELECT * FROM modifiers WHERE id IN (${(input.modifier_ids ?? [])
              .map(() => '?')
              .join(',')})`
          )
          .all(...(input.modifier_ids ?? [])) as Modifier[])
      : []

    const itemId = Number(
      db
        .prepare(
          `INSERT INTO order_items (order_id, menu_item_id, name, kitchen_name, station, qty,
             unit_price_cents, taxable, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.order_id,
          item.id,
          item.name,
          item.kitchen_name,
          item.station,
          input.qty,
          item.price_cents,
          item.taxable,
          input.notes ?? null
        ).lastInsertRowid
    )

    const insMod = db.prepare(
      'INSERT INTO order_item_modifiers (order_item_id, modifier_id, name, price_cents) VALUES (?, ?, ?, ?)'
    )
    for (const m of mods) insMod.run(itemId, m.id, m.name, m.price_cents)

    recalcLine(itemId)
  })()

  return getOrder(input.order_id)
}

export function updateItem(input: UpdateItemInput): Order {
  const db = getDb()
  const row = db.prepare('SELECT order_id, status FROM order_items WHERE id = ?').get(
    input.order_item_id
  ) as { order_id: number; status: string } | undefined
  if (!row) throw new Error(`Order item ${input.order_item_id} not found`)

  assertOpen(getOrder(row.order_id))
  if (row.status === 'voided') throw new Error('Cannot edit a voided line')

  db.transaction(() => {
    if (input.qty !== undefined) {
      if (input.qty <= 0) throw new Error('Use removeItem to take a line off the check')
      db.prepare('UPDATE order_items SET qty = ? WHERE id = ?').run(input.qty, input.order_item_id)
    }
    if (input.notes !== undefined) {
      db.prepare('UPDATE order_items SET notes = ? WHERE id = ?').run(
        input.notes,
        input.order_item_id
      )
    }
    recalcLine(input.order_item_id)
  })()

  return getOrder(row.order_id)
}

/**
 * Takes a line off the check.
 *
 * A line the kitchen has never seen is simply deleted. A line already fired is
 * marked `voided` and kept, then a VOID ticket goes to its station — the food
 * may already be on the pass, and the kitchen has to be told. The voided row
 * stays in the database so the day's void report is honest.
 */
export async function removeItem(
  orderItemId: number,
  reason?: string
): Promise<{ order: Order; prints: PrintResult[] }> {
  const db = getDb()

  const row = db
    .prepare('SELECT order_id, status FROM order_items WHERE id = ?')
    .get(orderItemId) as { order_id: number; status: string } | undefined
  if (!row) throw new Error(`Order item ${orderItemId} not found`)

  const order = getOrder(row.order_id)
  assertOpen(order)

  if (row.status === 'pending') {
    db.prepare('DELETE FROM order_items WHERE id = ?').run(orderItemId)
    return { order: getOrder(row.order_id), prints: [] }
  }

  if (row.status === 'voided') return { order, prints: [] }

  const voided = order.items.find((i) => i.id === orderItemId)!

  db.prepare("UPDATE order_items SET status = 'voided', notes = ? WHERE id = ?").run(
    reason ? `${voided.notes ? voided.notes + ' | ' : ''}VOID: ${reason}` : voided.notes,
    orderItemId
  )

  const after = getOrder(row.order_id)
  const prints = await printVoidTickets(after, [{ ...voided, status: 'voided' }])
  return { order: after, prints }
}

/** unit price + modifier prices, times quantity. */
function recalcLine(orderItemId: number): void {
  const db = getDb()
  db.prepare(
    `UPDATE order_items SET line_total_cents = qty * (
       unit_price_cents + COALESCE(
         (SELECT SUM(price_cents) FROM order_item_modifiers WHERE order_item_id = order_items.id), 0)
     ) WHERE id = ?`
  ).run(orderItemId)
}

/* ---------- firing to the kitchen ---------- */

/**
 * Sends everything still `pending` to the stations, as one new round.
 *
 * The transaction picks the items and marks them `fired` before any byte is
 * written to a socket, so a double-tap on "Send to Kitchen" cannot print the
 * same food twice. Printing then happens outside the transaction because a
 * wedged printer must not hold a write lock on the database.
 */
export async function fireOrder(orderId: number): Promise<{ order: Order; prints: PrintResult[] }> {
  const db = getDb()

  const claimed = db.transaction(() => {
    const order = getOrder(orderId)
    assertOpen(order)

    const pending = order.items.filter((i) => i.status === 'pending')
    if (!pending.length) return null

    const round = order.round + 1
    const mark = db.prepare("UPDATE order_items SET status='fired', fired_round=? WHERE id=?")
    for (const item of pending) mark.run(round, item.id)
    db.prepare('UPDATE orders SET round = ? WHERE id = ?').run(round, orderId)

    return { pending, round }
  })()

  if (!claimed) return { order: getOrder(orderId), prints: [] }

  const order = getOrder(orderId)
  const prints = await printKitchenTickets(order, claimed.pending, claimed.round, {})
  return { order, prints }
}

/** Reprints a round that was already fired — for a lost or jammed ticket. */
export async function reprintRound(
  orderId: number,
  round: number
): Promise<{ order: Order; prints: PrintResult[] }> {
  const order = getOrder(orderId)
  const items = order.items.filter((i) => i.fired_round === round && i.status !== 'voided')
  if (!items.length) throw new Error(`Round ${round} has no items to reprint`)

  const prints = await printKitchenTickets(order, items, round, { reprint: true })
  return { order, prints }
}

/* ---------- payment ---------- */

/**
 * Records a tender. Splitting is just several payments on one order, so the
 * order closes when the accumulated payments cover the total.
 */
export async function addPayment(
  input: AddPaymentInput
): Promise<{ order: Order; prints: PrintResult[] }> {
  const db = getDb()
  const settings = getSettings()

  const closed = db.transaction(() => {
    const order = getOrder(input.order_id)
    assertOpen(order)

    if (input.amount_cents <= 0) throw new Error('Payment amount must be greater than zero')
    if (!order.items.some((i) => i.status !== 'voided')) {
      throw new Error('Cannot take payment on an empty check')
    }
    if (input.amount_cents > order.totals.due_cents) {
      // Overpaying would make the day's takings not reconcile. For cash, the
      // caller passes the full tendered amount separately and we charge the due.
      throw new Error(
        `Payment exceeds the ${order.totals.due_cents / 100} still due on this check`
      )
    }

    db.prepare(
      `INSERT INTO payments (order_id, method, amount_cents, tendered_cents, reference)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      input.order_id,
      input.method,
      input.amount_cents,
      input.tendered_cents ?? null,
      input.reference ?? null
    )

    const after = getOrder(input.order_id)
    if (after.totals.due_cents === 0) {
      db.prepare("UPDATE orders SET status='paid', closed_at=datetime('now') WHERE id=?").run(
        input.order_id
      )
      return true
    }
    return false
  })()

  const order = getOrder(input.order_id)
  const prints =
    closed && settings.auto_print_receipt ? await printReceipt(order) : ([] as PrintResult[])

  return { order, prints }
}

export function removePayment(paymentId: number): Order {
  const db = getDb()
  const row = db.prepare('SELECT order_id FROM payments WHERE id = ?').get(paymentId) as
    | { order_id: number }
    | undefined
  if (!row) throw new Error(`Payment ${paymentId} not found`)

  db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId)
    // Removing a tender reopens the check, otherwise it would sit "paid" with a
    // balance outstanding.
    db.prepare("UPDATE orders SET status='open', closed_at=NULL WHERE id=?").run(row.order_id)
  })()

  return getOrder(row.order_id)
}

/** Voids a whole check. Requires a reason: this is the audited path. */
export async function voidOrder(
  orderId: number,
  reason: string
): Promise<{ order: Order; prints: PrintResult[] }> {
  if (!reason.trim()) throw new Error('A reason is required to void a check')

  const db = getDb()
  const order = getOrder(orderId)
  assertOpen(order)

  if (order.payments.length) {
    throw new Error('Remove the payments on this check before voiding it')
  }

  const fired = order.items.filter((i) => i.status === 'fired')

  db.transaction(() => {
    db.prepare("UPDATE order_items SET status='voided' WHERE order_id=? AND status!='voided'").run(
      orderId
    )
    db.prepare(
      `UPDATE orders SET status='void', closed_at=datetime('now'),
       note = COALESCE(note || ' | ', '') || 'VOID: ' || ? WHERE id=?`
    ).run(reason.trim(), orderId)
  })()

  const after = getOrder(orderId)
  // Anything the kitchen already started needs to be stopped.
  const prints = fired.length ? await printVoidTickets(after, fired) : []
  return { order: after, prints }
}

export async function reprintReceipt(orderId: number): Promise<PrintResult[]> {
  return printReceipt(getOrder(orderId), { reprint: true })
}

/** Prints the bill for the table before payment — a "pre-check". */
export async function printBill(orderId: number): Promise<PrintResult[]> {
  return printReceipt(getOrder(orderId))
}

function assertOpen(order: Order): void {
  if (order.status !== 'open') {
    throw new Error(`Order #${order.order_number} is ${order.status} and can no longer be changed`)
  }
}
