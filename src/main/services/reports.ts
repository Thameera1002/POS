import { getDb } from '../db'
import { computeTotals, getOrder } from './orders'
import type { SalesReport, OrderType, PaymentMethod } from '../../shared/types'

/**
 * Sales figures for a date range (inclusive, local dates as YYYY-MM-DD).
 *
 * Only `paid` orders count toward revenue — open checks are not money yet, and
 * voided ones never will be. Totals are recomputed through `computeTotals` so
 * the report and the receipt can never disagree.
 */
export function salesReport(from: string, to: string): SalesReport {
  const db = getDb()
  const lo = `${from} 00:00:00`
  const hi = `${to} 23:59:59`

  const orders = db
    .prepare(
      `SELECT id, order_type, guest_count, closed_at FROM orders
       WHERE status = 'paid' AND closed_at BETWEEN ? AND ? ORDER BY closed_at`
    )
    .all(lo, hi) as { id: number; order_type: OrderType; guest_count: number; closed_at: string }[]

  let gross = 0
  let discount = 0
  let service = 0
  let tax = 0
  let guests = 0

  const byType = new Map<OrderType, { amount_cents: number; count: number }>()
  const byHour = new Map<string, { amount_cents: number; order_count: number }>()

  for (const o of orders) {
    const t = computeTotals(getOrder(o.id))
    gross += t.subtotal_cents
    discount += t.discount_cents
    service += t.service_charge_cents
    tax += t.tax_cents
    guests += o.guest_count

    const type = byType.get(o.order_type) ?? { amount_cents: 0, count: 0 }
    type.amount_cents += t.total_cents
    type.count += 1
    byType.set(o.order_type, type)

    const hour = o.closed_at.slice(11, 13) + ':00'
    const slot = byHour.get(hour) ?? { amount_cents: 0, order_count: 0 }
    slot.amount_cents += t.total_cents
    slot.order_count += 1
    byHour.set(hour, slot)
  }

  const byMethod = db
    .prepare(
      `SELECT p.method, SUM(p.amount_cents) AS amount_cents, COUNT(*) AS count
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE o.status = 'paid' AND o.closed_at BETWEEN ? AND ?
       GROUP BY p.method ORDER BY amount_cents DESC`
    )
    .all(lo, hi) as { method: PaymentMethod; amount_cents: number; count: number }[]

  const topItems = db
    .prepare(
      `SELECT i.name, SUM(i.qty) AS qty, SUM(i.line_total_cents) AS revenue_cents
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status = 'paid' AND i.status != 'voided' AND o.closed_at BETWEEN ? AND ?
       GROUP BY i.name ORDER BY qty DESC LIMIT 15`
    )
    .all(lo, hi) as { name: string; qty: number; revenue_cents: number }[]

  return {
    from,
    to,
    order_count: orders.length,
    guest_count: guests,
    gross_cents: gross,
    discount_cents: discount,
    service_charge_cents: service,
    tax_cents: tax,
    net_cents: gross - discount + service + tax,
    by_method: byMethod,
    by_type: [...byType].map(([order_type, v]) => ({ order_type, ...v })),
    top_items: topItems,
    by_hour: [...byHour]
      .map(([hour, v]) => ({ hour, ...v }))
      .sort((a, b) => a.hour.localeCompare(b.hour))
  }
}

/**
 * End-of-shift cash reconciliation: what the drawer should hold versus what was
 * counted, so a discrepancy is visible before staff go home.
 */
export function shiftSummary(day: string): {
  day: string
  cash_expected_cents: number
  card_cents: number
  other_cents: number
  order_count: number
  void_count: number
  voided_item_cents: number
} {
  const db = getDb()
  const lo = `${day} 00:00:00`
  const hi = `${day} 23:59:59`

  const methods = db
    .prepare(
      `SELECT p.method, SUM(p.amount_cents) AS total FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE o.status='paid' AND o.closed_at BETWEEN ? AND ? GROUP BY p.method`
    )
    .all(lo, hi) as { method: PaymentMethod; total: number }[]

  const pick = (m: PaymentMethod): number => methods.find((x) => x.method === m)?.total ?? 0

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
         SUM(CASE WHEN status='void' THEN 1 ELSE 0 END) AS voided
       FROM orders WHERE COALESCE(closed_at, opened_at) BETWEEN ? AND ?`
    )
    .get(lo, hi) as { paid: number | null; voided: number | null }

  const voidedValue = db
    .prepare(
      `SELECT COALESCE(SUM(i.line_total_cents), 0) AS total FROM order_items i
       JOIN orders o ON o.id = i.order_id
       WHERE i.status='voided' AND COALESCE(o.closed_at, o.opened_at) BETWEEN ? AND ?`
    )
    .get(lo, hi) as { total: number }

  return {
    day,
    cash_expected_cents: pick('cash'),
    card_cents: pick('card'),
    other_cents: pick('mobile') + pick('other'),
    order_count: counts.paid ?? 0,
    void_count: counts.voided ?? 0,
    voided_item_cents: voidedValue.total
  }
}
