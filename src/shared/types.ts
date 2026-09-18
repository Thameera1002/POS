/**
 * Types shared by the main and renderer processes.
 *
 * Money is stored and passed around everywhere as integer cents. Floats never
 * touch a total.
 */

export type Station = 'kitchen' | 'grill' | 'bar' | 'dessert' | 'none'

export const STATIONS: Exclude<Station, 'none'>[] = ['kitchen', 'grill', 'bar', 'dessert']

export type OrderType = 'dine_in' | 'takeaway' | 'delivery'

/** Lifecycle of a whole order (a "check"). */
export type OrderStatus = 'open' | 'paid' | 'void'

/**
 * Lifecycle of a single line on the check. This is what makes incremental
 * kitchen printing possible:
 *  - `pending` — added to the check but the kitchen has not seen it yet.
 *  - `fired`   — printed on a kitchen ticket; the line is now the kitchen's.
 *  - `voided`  — removed after firing, so the kitchen needs a VOID ticket.
 */
export type OrderItemStatus = 'pending' | 'fired' | 'voided'

export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'other'

export type PrinterTransport = 'tcp' | 'cups' | 'preview'

export type TicketKind = 'kitchen' | 'void' | 'receipt' | 'test'

export interface Category {
  id: number
  name: string
  color: string
  sort_order: number
  active: number
}

export interface MenuItem {
  id: number
  category_id: number
  name: string
  /** Short name used on kitchen tickets, where width is 32-48 chars. */
  kitchen_name: string | null
  price_cents: number
  station: Station
  /** Item is taxable; non-taxable items (e.g. some cold takeaway) skip tax. */
  taxable: number
  active: number
  sort_order: number
}

export interface ModifierGroup {
  id: number
  name: string
  min_select: number
  max_select: number
}

export interface Modifier {
  id: number
  group_id: number
  name: string
  price_cents: number
}

export interface MenuItemWithModifiers extends MenuItem {
  modifier_groups: (ModifierGroup & { modifiers: Modifier[] })[]
}

export interface DiningTable {
  id: number
  name: string
  seats: number
  /** Free-form room/zone label, e.g. "Terrace". */
  zone: string
  active: number
}

export interface OrderItemModifier {
  id: number
  order_item_id: number
  modifier_id: number | null
  name: string
  price_cents: number
}

export interface OrderItem {
  id: number
  order_id: number
  menu_item_id: number | null
  name: string
  kitchen_name: string | null
  station: Station
  qty: number
  unit_price_cents: number
  /** unit_price + modifiers, times qty. Recomputed on every mutation. */
  line_total_cents: number
  taxable: number
  notes: string | null
  status: OrderItemStatus
  /** Incrementing course/round number; each kitchen fire bumps it. */
  fired_round: number | null
  created_at: string
  modifiers: OrderItemModifier[]
}

export interface OrderTotals {
  subtotal_cents: number
  discount_cents: number
  service_charge_cents: number
  tax_cents: number
  total_cents: number
  paid_cents: number
  due_cents: number
}

export interface Payment {
  id: number
  order_id: number
  method: PaymentMethod
  amount_cents: number
  /** Cash tendered, so change can be shown/printed. */
  tendered_cents: number | null
  reference: string | null
  created_at: string
}

export interface Order {
  id: number
  /** Human-facing daily number, e.g. 42 -> "#0042". */
  order_number: number
  order_type: OrderType
  table_id: number | null
  table_name: string | null
  guest_count: number
  customer_name: string | null
  customer_phone: string | null
  status: OrderStatus
  /** Percent, 0-100, applied to subtotal. */
  discount_pct: number
  discount_cents: number
  service_charge_pct: number
  tax_pct: number
  note: string | null
  /** Highest fired_round so far; the next kitchen fire uses this + 1. */
  round: number
  opened_at: string
  closed_at: string | null
  items: OrderItem[]
  payments: Payment[]
  totals: OrderTotals
}

export interface OrderSummary {
  id: number
  order_number: number
  order_type: OrderType
  table_name: string | null
  guest_count: number
  customer_name?: string | null
  customer_phone?: string | null
  status: OrderStatus
  total_cents: number
  item_count: number
  /** True when any line is still `pending` — the ticket is not with the kitchen. */
  has_unsent: number
  opened_at: string
  closed_at: string | null
}

export interface Printer {
  id: number
  name: string
  transport: PrinterTransport
  /** IP for tcp, CUPS queue name for cups, ignored for preview. */
  target: string
  port: number
  /** Characters per line: 32 for 58mm, 48 for 80mm paper. */
  width: number
  /** Stations routed to this printer. Empty for a receipt-only printer. */
  stations: Station[]
  is_receipt: number
  /** Send a drawer-kick pulse after receipts on this printer. */
  cash_drawer: number
  copies: number
  active: number
}

export interface PrintJob {
  id: number
  printer_id: number
  printer_name: string
  order_id: number | null
  kind: TicketKind
  status: 'queued' | 'printing' | 'done' | 'failed'
  attempts: number
  error: string | null
  /** Plain-text render of the ticket, for the preview window and reprints. */
  preview: string
  created_at: string
}

/**
 * How the venue trades. A takeaway-only shop has no tables, so showing it a
 * floor plan is noise — the whole floor concept disappears from the UI and the
 * counter becomes the home screen.
 */
export type ServiceMode = 'dine_in' | 'takeaway' | 'both'

export interface Settings {
  restaurant_name: string
  address: string
  phone: string
  tax_id: string
  currency_symbol: string
  service_mode: ServiceMode
  /** Takeaway is usually paid up front, so offer send-and-settle in one action. */
  takeaway_pay_first: number
  /** Default tax percent applied to new orders. */
  tax_pct: number
  /** Default service charge percent, dine-in only. */
  service_charge_pct: number
  receipt_footer: string
  /** Print a customer receipt automatically when an order is fully paid. */
  auto_print_receipt: number
}

export interface PrintResult {
  printer_id: number
  printer_name: string
  kind: TicketKind
  ok: boolean
  error?: string
  preview: string
  job_id: number
}

export interface SalesReport {
  from: string
  to: string
  order_count: number
  guest_count: number
  gross_cents: number
  discount_cents: number
  service_charge_cents: number
  tax_cents: number
  net_cents: number
  by_method: { method: PaymentMethod; amount_cents: number; count: number }[]
  by_type: { order_type: OrderType; amount_cents: number; count: number }[]
  top_items: { name: string; qty: number; revenue_cents: number }[]
  by_hour: { hour: string; amount_cents: number; order_count: number }[]
}

/* ---------- IPC request payloads ---------- */

export interface CreateOrderInput {
  order_type: OrderType
  table_id?: number | null
  guest_count?: number
  customer_name?: string | null
  customer_phone?: string | null
  /** Delivery address, or any standing instruction for the whole order. */
  note?: string | null
}

export interface AddItemInput {
  order_id: number
  menu_item_id: number
  qty: number
  notes?: string | null
  modifier_ids?: number[]
}

export interface UpdateItemInput {
  order_item_id: number
  qty?: number
  notes?: string | null
}

/** Filters for the transactions list — how a takeaway order stays traceable. */
export interface OrderFilter {
  status?: OrderStatus | 'all'
  order_type?: OrderType | 'all'
  /** Local YYYY-MM-DD, inclusive. */
  from?: string
  to?: string
  /** Matches order number, customer name or phone. */
  query?: string
  limit?: number
}

export interface MenuItemInput {
  category_id: number
  name: string
  kitchen_name: string | null
  price_cents: number
  station: Station
  taxable: number
  active: number
  sort_order: number
  /** Modifier groups offered with this item, replacing any existing links. */
  modifier_group_ids?: number[]
}

export interface AddPaymentInput {
  order_id: number
  method: PaymentMethod
  amount_cents: number
  tendered_cents?: number | null
  reference?: string | null
}
