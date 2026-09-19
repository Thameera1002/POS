import { EscPos } from './escpos'
import type { Order, OrderItem, Settings, Station } from '../../shared/types'

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: 'DINE IN',
  takeaway: 'TAKE AWAY',
  delivery: 'DELIVERY'
}

const STATION_LABEL: Record<Station, string> = {
  kitchen: 'KITCHEN',
  grill: 'GRILL',
  bar: 'BAR',
  dessert: 'PASTRY',
  none: 'ORDER'
}

/**
 * A kitchen ticket. Designed to be read from two metres away by someone whose
 * hands are full, so:
 *  - quantity and item name are double-height, everything else is small
 *  - modifiers and notes are indented under their item and marked, never
 *    inlined, because a missed "NO PEANUTS" is the worst bug in this system
 *  - the station, table and round number are in the header, since a cook
 *    holding one ticket has no other context
 *  - no prices at all: money is not the kitchen's concern and only adds noise
 */
export function kitchenTicket(
  order: Order,
  items: OrderItem[],
  station: Station,
  round: number,
  width: number,
  opts: { reprint?: boolean } = {}
): EscPos {
  const p = new EscPos(width)

  p.beep(2)
  p.text(STATION_LABEL[station], { bold: true, doubleWidth: true, doubleHeight: true, align: 'center' })

  if (opts.reprint) p.text('*** REPRINT ***', { bold: true, invert: true, align: 'center' })

  p.rule('=')
  p.text(destinationLine(order), { bold: true, doubleHeight: true, align: 'center' })
  p.row(`#${orderNo(order)}`, ORDER_TYPE_LABEL[order.order_type] ?? '', { bold: true })
  p.row(`Round ${round}`, timeOfDay())
  if (order.order_type === 'dine_in') p.row(`Guests: ${order.guest_count}`, '')
  if (order.customer_name) p.text(`Cust: ${order.customer_name}`)
  if (order.customer_phone) p.text(`Tel:  ${order.customer_phone}`)
  // A delivery address is what the driver reads off the bag, so it gets its own
  // bold block rather than a one-liner buried among the other headers.
  if (order.delivery_address) {
    p.text('DELIVER TO:', { bold: true })
    p.text(order.delivery_address.toUpperCase(), { bold: true })
  }
  // Standing instructions for the whole order ("all together please") belong at
  // the top where they are read before anything is started.
  if (order.note) p.text(`** ${order.note.toUpperCase()} **`, { bold: true })
  p.rule('=')

  for (const item of items) {
    const voided = item.status === 'voided'
    const name = item.kitchen_name || item.name

    if (voided) p.text('*** VOID ***', { bold: true, invert: true })
    p.text(`${item.qty} x ${name}`.toUpperCase(), {
      bold: true,
      doubleWidth: true,
      doubleHeight: true
    })

    for (const mod of item.modifiers) {
      p.text(`   > ${mod.name.toUpperCase()}`, { bold: true })
    }
    if (item.notes) {
      p.text(`   ** ${item.notes.toUpperCase()} **`, { bold: true, doubleHeight: true })
    }
    p.feed(1)
  }

  p.rule('=')
  p.text(`${items.reduce((n, i) => n + i.qty, 0)} item(s)`, { align: 'center' })
  p.text(stamp(), { align: 'center' })
  p.cut()
  return p
}

/**
 * A ticket telling the kitchen to stop making something already fired. Kept
 * visually distinct from a normal ticket so it cannot be misread as a new order.
 */
export function voidTicket(
  order: Order,
  items: OrderItem[],
  station: Station,
  width: number
): EscPos {
  const p = new EscPos(width)

  p.beep(4)
  p.text('CANCEL', { bold: true, doubleWidth: true, doubleHeight: true, align: 'center', invert: true })
  p.text(STATION_LABEL[station], { bold: true, align: 'center' })
  p.rule('=')
  p.text(destinationLine(order), { bold: true, doubleHeight: true, align: 'center' })
  p.row(`#${orderNo(order)}`, timeOfDay(), { bold: true })
  p.rule('=')

  for (const item of items) {
    p.text(`DO NOT MAKE:`, { bold: true })
    p.text(`${item.qty} x ${(item.kitchen_name || item.name).toUpperCase()}`, {
      bold: true,
      doubleWidth: true,
      doubleHeight: true
    })
    for (const mod of item.modifiers) p.text(`   > ${mod.name.toUpperCase()}`)
    p.feed(1)
  }

  p.rule('=')
  p.text(stamp(), { align: 'center' })
  p.cut()
  return p
}

/** The customer-facing bill. Itemised, with tax broken out and change shown. */
export function receipt(
  order: Order,
  settings: Settings,
  width: number,
  opts: { reprint?: boolean; drawer?: boolean } = {}
): EscPos {
  const p = new EscPos(width)
  const cur = (cents: number): string => `${settings.currency_symbol}${fmt(cents)}`

  p.text(settings.restaurant_name.toUpperCase(), {
    bold: true,
    doubleWidth: true,
    doubleHeight: true,
    align: 'center'
  })
  if (settings.address) p.text(settings.address, { align: 'center' })
  if (settings.phone) p.text(`Tel: ${settings.phone}`, { align: 'center' })
  if (settings.tax_id) p.text(settings.tax_id, { align: 'center' })
  p.feed(1)

  if (opts.reprint) p.text('*** REPRINT ***', { bold: true, align: 'center' })

  p.rule('=')
  p.row(`Bill #${orderNo(order)}`, ORDER_TYPE_LABEL[order.order_type] ?? '', { bold: true })
  p.row(order.table_name ? `Table ${order.table_name}` : '—', stamp())
  if (order.order_type === 'dine_in') p.row(`Guests: ${order.guest_count}`, '')
  if (order.customer_name) p.text(`Customer: ${order.customer_name}`)
  if (order.customer_phone) p.text(`Phone: ${order.customer_phone}`)
  if (order.delivery_address) p.text(`Deliver to: ${order.delivery_address}`)
  if (order.note) p.text(order.note)
  p.rule('=')

  for (const item of order.items) {
    if (item.status === 'voided') continue
    p.row(`${item.qty} x ${item.name}`, fmt(item.line_total_cents))
    for (const mod of item.modifiers) {
      p.row(`    + ${mod.name}`, mod.price_cents ? fmt(mod.price_cents * item.qty) : '')
    }
    if (item.notes) p.text(`    (${item.notes})`)
  }

  p.rule('-')
  p.row('Subtotal', fmt(order.totals.subtotal_cents))
  if (order.totals.discount_cents > 0) {
    p.row(`Discount (${order.discount_pct}%)`, `-${fmt(order.totals.discount_cents)}`)
  }
  if (order.totals.service_charge_cents > 0) {
    p.row(`Service charge (${order.service_charge_pct}%)`, fmt(order.totals.service_charge_cents))
  }
  if (order.totals.tax_cents > 0) {
    p.row(`Tax (${order.tax_pct}%)`, fmt(order.totals.tax_cents))
  }
  p.rule('-')
  p.text(`TOTAL  ${cur(order.totals.total_cents)}`, {
    bold: true,
    doubleWidth: true,
    doubleHeight: true,
    align: 'right'
  })
  p.rule('-')

  for (const pay of order.payments) {
    p.row(pay.method.toUpperCase(), fmt(pay.amount_cents))
    if (pay.method === 'cash' && pay.tendered_cents != null) {
      p.row('  Tendered', fmt(pay.tendered_cents))
      p.row('  Change', fmt(Math.max(0, pay.tendered_cents - pay.amount_cents)))
    }
    if (pay.reference) p.text(`  Ref: ${pay.reference}`)
  }
  if (order.totals.due_cents > 0) {
    p.row('BALANCE DUE', fmt(order.totals.due_cents), { bold: true })
  }

  p.feed(1)
  if (settings.receipt_footer) p.text(settings.receipt_footer, { align: 'center' })
  p.feed(1)
  p.barcode(String(order.order_number).padStart(6, '0'))

  if (opts.drawer) p.kickDrawer()
  p.cut()
  return p
}

/** Alignment/connectivity check printed from the Settings screen. */
export function testTicket(printerName: string, width: number): EscPos {
  const p = new EscPos(width)
  p.text('PRINTER TEST', { bold: true, doubleWidth: true, doubleHeight: true, align: 'center' })
  p.rule('=')
  p.row('Printer', printerName)
  p.row('Width', `${width} cols`)
  p.row('Time', stamp())
  p.rule('=')
  p.text('The ruler below must end flush with')
  p.text('the right edge of the paper:')
  p.text(ruler(width))
  p.rule('=')
  p.text('normal')
  p.text('bold', { bold: true })
  p.text('double', { doubleWidth: true, doubleHeight: true })
  p.text('inverted', { invert: true })
  p.cut()
  return p
}

/* ---------- helpers ---------- */

function ruler(width: number): string {
  let s = ''
  for (let i = 1; i <= width; i++) s += i % 10 === 0 ? '|' : String(i % 10)
  return s
}

function destinationLine(order: Order): string {
  if (order.order_type === 'dine_in') return `TABLE ${order.table_name ?? '?'}`
  if (order.order_type === 'takeaway') return 'TAKE AWAY'
  return `DELIVERY${order.customer_name ? ` - ${order.customer_name}` : ''}`
}

function orderNo(order: Order): string {
  return String(order.order_number).padStart(4, '0')
}

function fmt(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`
}

function timeOfDay(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function stamp(): string {
  const d = new Date()
  return `${d.toLocaleDateString('en-GB')} ${timeOfDay()}`
}
