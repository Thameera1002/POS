import { useCallback, useEffect, useState } from 'react'
import { usePos } from '../store'
import { Modal } from '../components/Modal'
import { cn, clock, money, orderNo, today } from '../lib/format'
import type { Order, OrderFilter, OrderStatus, OrderSummary, OrderType } from '../../../shared/types'

const STATUS_STYLE: Record<OrderStatus, string> = {
  open: 'bg-amber-500/20 text-amber-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
  void: 'bg-rose-500/20 text-rose-300'
}

/**
 * Every transaction, searchable.
 *
 * This is the counterpart to keeping takeaway off the floor plan: an order that
 * never occupied a table still has to be findable afterwards — when a customer
 * rings back about a collection, when a manager reconciles the day, or when a
 * receipt needs reprinting.
 */
export function OrdersScreen() {
  const { settings, toast, loadOrder } = usePos()
  const [rows, setRows] = useState<OrderSummary[]>([])
  const [detail, setDetail] = useState<Order | null>(null)
  const [loading, setLoading] = useState(false)

  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [type, setType] = useState<OrderType | 'all'>('all')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [query, setQuery] = useState('')

  const sym = settings?.currency_symbol ?? ''

  const load = useCallback(
    async (override: Partial<OrderFilter> = {}): Promise<void> => {
      setLoading(true)
      try {
        setRows(
          await window.pos.orders.search({ status, order_type: type, from, to, query, ...override })
        )
      } catch (err) {
        toast('error', err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [status, type, from, to, query, toast]
  )

  useEffect(() => {
    void load()
  }, [load])

  const totals = rows.reduce(
    (acc, r) => {
      if (r.status === 'paid') {
        acc.paid += r.total_cents
        acc.paidCount += 1
      }
      if (r.status === 'open') acc.open += r.total_cents
      return acc
    },
    { paid: 0, paidCount: 0, open: 0 }
  )

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 pt-6 pb-4">
        <h1 className="text-2xl font-bold mb-4">Orders</h1>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="label">Search</label>
            <input
              className="field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Order number, customer name, phone or address"
            />
          </div>
          <div>
            <label className="label">From</label>
            <input
              type="date"
              className="field w-[150px]"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="label">To</label>
            <input
              type="date"
              className="field w-[150px]"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-4">
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              ['all', 'All'],
              ['open', 'Open'],
              ['paid', 'Paid'],
              ['void', 'Void']
            ]}
          />
          <Segmented
            value={type}
            onChange={setType}
            options={[
              ['all', 'Any type'],
              ['dine_in', 'Dine in'],
              ['takeaway', 'Takeaway'],
              ['delivery', 'Delivery']
            ]}
          />
        </div>

        <div className="flex gap-5 mt-4 text-sm">
          <span className="text-slate-400">
            {rows.length} order{rows.length === 1 ? '' : 's'}
          </span>
          <span>
            <span className="text-slate-400">Settled </span>
            <span className="font-bold tabular-nums">{money(totals.paid, sym)}</span>
            <span className="text-slate-500"> ({totals.paidCount})</span>
          </span>
          {totals.open > 0 && (
            <span>
              <span className="text-slate-400">Still open </span>
              <span className="font-bold tabular-nums text-amber-400">
                {money(totals.open, sym)}
              </span>
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-6">
        <div className="panel divide-y divide-ink-600">
          {loading && <p className="px-5 py-8 text-sm text-slate-500 text-center">Loading…</p>}

          {!loading && rows.length === 0 && (
            <p className="px-5 py-10 text-sm text-slate-500 text-center">
              No orders match those filters.
            </p>
          )}

          {!loading &&
            rows.map((o) => (
              <div key={o.id} className="flex items-center gap-4 px-5 py-3 hover:bg-ink-700/40">
                <span className="font-bold tabular-nums w-[64px] shrink-0">
                  {orderNo(o.order_number)}
                </span>

                <span className={cn('chip w-[52px] justify-center shrink-0', STATUS_STYLE[o.status])}>
                  {o.status}
                </span>

                <span className="chip bg-ink-600 text-slate-300 w-[76px] justify-center shrink-0">
                  {o.order_type === 'dine_in'
                    ? (o.table_name ?? 'dine in')
                    : o.order_type === 'takeaway'
                      ? 'takeaway'
                      : 'delivery'}
                </span>

                <div className="flex-1 min-w-0">
                  {o.customer_name || o.customer_phone ? (
                    <p className="text-sm truncate">
                      {o.customer_name}
                      {o.customer_phone && (
                        <span className="text-slate-500 font-mono ml-2">{o.customer_phone}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">{o.item_count} items</p>
                  )}
                </div>

                <span className="text-[11px] text-slate-500 shrink-0 w-[46px]">
                  {clock(o.closed_at ?? o.opened_at)}
                </span>

                <span className="font-bold tabular-nums w-[88px] text-right shrink-0">
                  {money(o.total_cents, sym)}
                </span>

                <div className="flex gap-2 shrink-0">
                  <button
                    className="btn-ghost text-xs"
                    onClick={async () => {
                      try {
                        setDetail(await window.pos.orders.get(o.id))
                      } catch (err) {
                        toast('error', err instanceof Error ? err.message : String(err))
                      }
                    }}
                  >
                    View
                  </button>
                  {o.status === 'open' && (
                    <button className="btn-ghost text-xs" onClick={() => loadOrder(o.id)}>
                      Open
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      <OrderDetail order={detail} onClose={() => setDetail(null)} onChanged={() => load()} />
    </div>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <div className="flex gap-1 bg-ink-700 rounded-xl p-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
            value === key ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function OrderDetail({
  order,
  onClose,
  onChanged
}: {
  order: Order | null
  onClose: () => void
  onChanged: () => void
}) {
  const { settings, toast, showPreview } = usePos()
  if (!order) return null

  const sym = settings?.currency_symbol ?? ''

  const reprint = async (): Promise<void> => {
    try {
      const prints = await window.pos.orders.reprintReceipt(order.id)
      const failed = prints.filter((p) => !p.ok)
      failed.length
        ? toast('error', failed[0].error ?? 'Reprint failed', prints)
        : toast('success', 'Receipt reprinted', prints)
      if (prints.length) showPreview(prints)
      onChanged()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open
      title={`Order ${orderNo(order.order_number)}`}
      subtitle={`${order.order_type.replace('_', ' ')}${
        order.table_name ? ` · table ${order.table_name}` : ''
      } · ${order.status}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost mr-auto" onClick={reprint}>
            Reprint receipt
          </button>
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {(order.customer_name || order.customer_phone || order.delivery_address || order.note) && (
          <div className="panel bg-ink-700/50 px-4 py-3 text-sm space-y-1">
            {order.customer_name && <p>{order.customer_name}</p>}
            {order.customer_phone && (
              <p className="font-mono text-slate-400">{order.customer_phone}</p>
            )}
            {order.delivery_address && (
              <p className="text-slate-300">Deliver to: {order.delivery_address}</p>
            )}
            {order.note && <p className="text-slate-400">{order.note}</p>}
          </div>
        )}

        <div>
          <p className="label">Items</p>
          {order.items.map((i) => (
            <div
              key={i.id}
              className={cn(
                'flex items-start justify-between py-1.5 text-sm',
                i.status === 'voided' && 'opacity-40 line-through'
              )}
            >
              <div className="min-w-0">
                <span>
                  {i.qty} × {i.name}
                </span>
                {i.modifiers.map((m) => (
                  <p key={m.id} className="text-[11px] text-slate-400 pl-3">
                    + {m.name}
                  </p>
                ))}
                {i.notes && <p className="text-[11px] text-amber-300 pl-3">{i.notes}</p>}
              </div>
              <span className="tabular-nums shrink-0 ml-3">{money(i.line_total_cents, sym)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-ink-600 pt-3 space-y-1.5 text-sm">
          <Row label="Subtotal" value={money(order.totals.subtotal_cents, sym)} />
          {order.totals.discount_cents > 0 && (
            <Row label="Discount" value={`−${money(order.totals.discount_cents, sym)}`} />
          )}
          {order.totals.service_charge_cents > 0 && (
            <Row label="Service" value={money(order.totals.service_charge_cents, sym)} />
          )}
          {order.totals.tax_cents > 0 && (
            <Row label="Tax" value={money(order.totals.tax_cents, sym)} />
          )}
          <div className="flex justify-between font-bold text-base pt-2 border-t border-ink-600">
            <span>Total</span>
            <span className="tabular-nums">{money(order.totals.total_cents, sym)}</span>
          </div>
        </div>

        {order.payments.length > 0 && (
          <div>
            <p className="label">Payments</p>
            {order.payments.map((p) => (
              <div key={p.id} className="flex justify-between py-1 text-sm">
                <span className="capitalize">
                  {p.method}
                  {p.reference && <span className="text-slate-500 ml-2">{p.reference}</span>}
                </span>
                <span className="tabular-nums">{money(p.amount_cents, sym)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
