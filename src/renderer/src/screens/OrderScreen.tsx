import { useMemo, useState } from 'react'
import { usePos } from '../store'
import { ModifierModal } from '../components/ModifierModal'
import { PaymentModal } from '../components/PaymentModal'
import { Modal } from '../components/Modal'
import { CustomerModal } from '../components/CustomerModal'
import { cn, money, orderNo } from '../lib/format'
import type { MenuItemWithModifiers, Order, OrderItem, Station } from '../../../shared/types'

const STATION_DOT: Record<Station, string> = {
  kitchen: 'bg-orange-400',
  grill: 'bg-red-400',
  bar: 'bg-violet-400',
  dessert: 'bg-pink-400',
  none: 'bg-slate-500'
}

/** Menu on the left, the check on the right — the standard two-pane POS layout. */
export function OrderScreen() {
  const { activeOrder, menu, categories, closeOrder, settings } = usePos()
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<MenuItemWithModifiers | null>(null)
  const [paying, setPaying] = useState(false)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menu.filter((item) => {
      if (q) return item.name.toLowerCase().includes(q)
      return categoryId === null ? true : item.category_id === categoryId
    })
  }, [menu, categoryId, search])

  if (!activeOrder) return null
  const sym = settings?.currency_symbol ?? ''

  /**
   * Items with no modifier groups go straight onto the check — one tap. Anything
   * configurable opens the sheet, because guessing the doneness of a steak is
   * not a shortcut worth having.
   */
  const tap = (item: MenuItemWithModifiers): void => {
    setDetail(item)
  }

  return (
    <div className="h-full grid grid-cols-[1fr_420px]">
      <section className="flex flex-col min-w-0 border-r border-ink-600">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-ink-600">
          <button className="btn-ghost" onClick={closeOrder}>
            ←{' '}
            {activeOrder.order_type === 'dine_in'
              ? 'Floor'
              : activeOrder.order_type === 'delivery'
                ? 'Delivery'
                : 'Takeaway'}
          </button>
          <input
            className="field flex-1"
            placeholder="Search the menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 px-6 py-3 overflow-x-auto border-b border-ink-600">
          <button
            onClick={() => {
              setCategoryId(null)
              setSearch('')
            }}
            className={cn(
              'btn whitespace-nowrap',
              categoryId === null && !search ? 'bg-brand-500 text-white' : 'bg-ink-600 text-slate-300'
            )}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCategoryId(c.id)
                setSearch('')
              }}
              className={cn(
                'btn whitespace-nowrap',
                categoryId === c.id ? 'text-white' : 'bg-ink-600 text-slate-300'
              )}
              style={categoryId === c.id ? { backgroundColor: c.color } : undefined}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
            {visible.map((item) => (
              <button
                key={item.id}
                onClick={() => tap(item)}
                className="panel text-left p-4 min-h-[104px] flex flex-col justify-between
                           hover:border-brand-500/60 hover:bg-ink-700 transition-colors active:scale-[0.98]"
              >
                <span className="font-semibold text-sm leading-snug">{item.name}</span>
                <div className="flex items-center justify-between mt-2">
                  <span className="tabular-nums font-bold text-brand-400">
                    {money(item.price_cents, sym)}
                  </span>
                  <span
                    className={cn('h-2 w-2 rounded-full', STATION_DOT[item.station])}
                    title={`${item.station} station`}
                  />
                </div>
              </button>
            ))}
            {visible.length === 0 && (
              <p className="text-sm text-slate-500 col-span-full">No items match that search.</p>
            )}
          </div>
        </div>
      </section>

      <CheckPanel onPay={() => setPaying(true)} />

      <ModifierModal item={detail} onClose={() => setDetail(null)} />
      {paying && <PaymentModal order={activeOrder} onClose={() => setPaying(false)} />}
    </div>
  )
}

/** The check: lines, rounds, totals, and the send/pay actions. */
function CheckPanel({ onPay }: { onPay: () => void }) {
  const {
    activeOrder: order,
    settings,
    setQty,
    removeItem,
    fire,
    reprintRound,
    printBill,
    patchOrder,
    updateCustomer,
    voidOrder,
    busy
  } = usePos()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [discountOpen, setDiscountOpen] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)

  if (!order) return null
  const sym = settings?.currency_symbol ?? ''

  const pending = order.items.filter((i) => i.status === 'pending')
  const live = order.items.filter((i) => i.status !== 'voided')
  const rounds = [...new Set(order.items.map((i) => i.fired_round).filter(Boolean))] as number[]

  // Counter trade is pay-on-order; a seated table pays at the end.
  const payFirst =
    order.order_type !== 'dine_in' &&
    settings?.takeaway_pay_first === 1 &&
    order.totals.due_cents > 0

  return (
    <aside className="flex flex-col bg-ink-800 min-h-0">
      <header className="px-5 py-4 border-b border-ink-600">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">
              {order.table_name ? `Table ${order.table_name}` : orderNo(order.order_number)}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {orderNo(order.order_number)} · {order.order_type.replace('_', ' ')}
              {order.order_type === 'dine_in' && ` · ${order.guest_count} guests`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {pending.length > 0 && (
              <span className="chip bg-amber-500 text-amber-950">{pending.length} not sent</span>
            )}
            {order.round > 0 && (
              <span className="chip bg-ink-600 text-slate-400">round {order.round}</span>
            )}
          </div>
        </div>

        {order.order_type !== 'dine_in' && (
          <CustomerStrip order={order} onEdit={() => setCustomerOpen(true)} />
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {live.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-12">
            Tap menu items to build the check.
          </p>
        )}

        {live.map((item) => (
          <CheckLine
            key={item.id}
            item={item}
            symbol={sym}
            onQty={(q) => setQty(item.id, q)}
            onRemove={() => removeItem(item.id)}
          />
        ))}

        {order.items.some((i) => i.status === 'voided') && (
          <div className="mt-3 pt-3 border-t border-ink-600">
            <p className="label">Voided</p>
            {order.items
              .filter((i) => i.status === 'voided')
              .map((i) => (
                <p key={i.id} className="text-xs text-slate-500 line-through px-2 py-1">
                  {i.qty} × {i.name}
                </p>
              ))}
          </div>
        )}
      </div>

      <div className="border-t border-ink-600 px-5 py-4 space-y-1.5 text-sm">
        <Row label="Subtotal" value={money(order.totals.subtotal_cents, sym)} />
        {order.totals.discount_cents > 0 && (
          <Row
            label={`Discount ${order.discount_pct}%`}
            value={`−${money(order.totals.discount_cents, sym)}`}
            accent="text-amber-400"
          />
        )}
        {order.totals.service_charge_cents > 0 && (
          <Row
            label={`Service ${order.service_charge_pct}%`}
            value={money(order.totals.service_charge_cents, sym)}
          />
        )}
        {order.totals.tax_cents > 0 && (
          <Row label={`Tax ${order.tax_pct}%`} value={money(order.totals.tax_cents, sym)} />
        )}

        <div className="flex items-baseline justify-between pt-2 mt-2 border-t border-ink-600">
          <span className="font-bold">Total</span>
          <span className="text-2xl font-bold tabular-nums">
            {money(order.totals.total_cents, sym)}
          </span>
        </div>

        {order.totals.paid_cents > 0 && (
          <>
            <Row label="Paid" value={money(order.totals.paid_cents, sym)} accent="text-emerald-400" />
            <Row label="Due" value={money(order.totals.due_cents, sym)} accent="font-bold" />
          </>
        )}
      </div>

      <div className="border-t border-ink-600 p-4 space-y-2">
        {/* Firing is the primary action on this screen and is deliberately the
            largest, most obvious button.

            Takeaway is normally paid up front, so there it becomes one action:
            send the order and open the tender sheet. The payment sheet is only
            opened if every kitchen ticket actually printed — taking money for
            food the kitchen never heard about is the worst outcome here. */}
        <button
          className={cn('w-full', pending.length ? 'btn-primary' : 'btn-ghost')}
          onClick={async () => {
            const ok = await fire()
            if (ok && payFirst) onPay()
          }}
          disabled={busy || !pending.length}
        >
          {pending.length
            ? payFirst
              ? `Send ${pending.reduce((n, i) => n + i.qty, 0)} item(s) & take payment`
              : `Send ${pending.reduce((n, i) => n + i.qty, 0)} item(s) to kitchen`
            : 'Kitchen has everything'}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={printBill} disabled={busy || !live.length}>
            Print bill
          </button>
          <button
            className="btn-success"
            onClick={onPay}
            disabled={busy || !live.length || order.status !== 'open'}
          >
            {order.status === 'paid' ? 'Settled' : 'Payment'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button className="btn-ghost text-xs" onClick={() => setDiscountOpen(true)}>
            Discount
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={() => rounds.length && reprintRound(rounds[rounds.length - 1])}
            disabled={!rounds.length}
          >
            Reprint
          </button>
          <button
            className="btn-ghost text-xs text-rose-300"
            onClick={() => setVoiding(true)}
            disabled={order.status !== 'open'}
          >
            Void
          </button>
        </div>
      </div>

      <Modal
        open={voiding}
        title="Void this check"
        subtitle="Anything already sent to the kitchen will get a cancellation ticket."
        onClose={() => setVoiding(false)}
        width="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setVoiding(false)}>
              Keep it
            </button>
            <button
              className="btn-danger"
              disabled={!reason.trim()}
              onClick={async () => {
                await voidOrder(reason)
                setVoiding(false)
                setReason('')
              }}
            >
              Void check
            </button>
          </>
        }
      >
        <label className="label">Reason (recorded in the void report)</label>
        <input
          className="field"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. guest left, duplicate order"
          autoFocus
        />
      </Modal>

      <DiscountModal
        open={discountOpen}
        current={order.discount_pct}
        onClose={() => setDiscountOpen(false)}
        onApply={(pct) => patchOrder({ discount_pct: pct })}
      />

      {customerOpen && (
        <CustomerModal
          open
          mode={order.order_type === 'delivery' ? 'delivery' : 'takeaway'}
          title={order.order_type === 'delivery' ? 'Delivery details' : 'Customer details'}
          initial={order}
          onClose={() => setCustomerOpen(false)}
          onSubmit={updateCustomer}
        />
      )}
    </aside>
  )
}

/**
 * Who the order is for, under the check header. Takeaway shows a quiet
 * "add details" affordance for when a customer asks; delivery always shows the
 * address, because the driver reads it from here if the ticket is lost.
 */
function CustomerStrip({ order, onEdit }: { order: Order; onEdit: () => void }) {
  const has = order.customer_name || order.customer_phone || order.delivery_address

  if (!has) {
    return (
      <button
        onClick={onEdit}
        className="mt-3 text-xs text-slate-400 hover:text-brand-400 transition-colors"
      >
        + Add customer details
      </button>
    )
  }

  return (
    <button
      onClick={onEdit}
      className="mt-3 w-full text-left rounded-xl bg-ink-700/60 hover:bg-ink-700 px-3 py-2 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs">
          {order.customer_name && <p className="font-semibold truncate">{order.customer_name}</p>}
          {order.customer_phone && (
            <p className="text-slate-400 font-mono">{order.customer_phone}</p>
          )}
          {order.delivery_address && (
            <p className="text-slate-300 mt-1 leading-snug">{order.delivery_address}</p>
          )}
        </div>
        <span className="text-[11px] text-slate-500 shrink-0">edit</span>
      </div>
    </button>
  )
}

function CheckLine({
  item,
  symbol,
  onQty,
  onRemove
}: {
  item: OrderItem
  symbol: string
  onQty: (qty: number) => void
  onRemove: () => void
}) {
  const fired = item.status === 'fired'

  return (
    <div
      className={cn(
        'rounded-xl px-3 py-2.5 mb-1.5 group',
        fired ? 'bg-ink-700/50' : 'bg-amber-500/10 border border-amber-500/25'
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', STATION_DOT[item.station])} />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold leading-snug">{item.name}</span>
            <span className="text-sm font-bold tabular-nums shrink-0">
              {money(item.line_total_cents, symbol)}
            </span>
          </div>

          {item.modifiers.map((m) => (
            <p key={m.id} className="text-[11px] text-slate-400 pl-1">
              + {m.name}
              {m.price_cents > 0 && ` (${money(m.price_cents, symbol)})`}
            </p>
          ))}
          {item.notes && (
            <p className="text-[11px] text-amber-300 pl-1 mt-0.5">note: {item.notes}</p>
          )}

          <div className="flex items-center gap-1.5 mt-1.5">
            <button
              className="h-7 w-7 rounded-lg bg-ink-600 hover:bg-ink-500 text-sm font-bold"
              onClick={() => onQty(item.qty - 1)}
            >
              −
            </button>
            <span className="w-7 text-center text-sm font-bold tabular-nums">{item.qty}</span>
            <button
              className="h-7 w-7 rounded-lg bg-ink-600 hover:bg-ink-500 text-sm font-bold"
              onClick={() => onQty(item.qty + 1)}
            >
              +
            </button>

            {fired ? (
              <span className="chip bg-emerald-500/15 text-emerald-400 ml-1">
                sent · r{item.fired_round}
              </span>
            ) : (
              <span className="chip bg-amber-500/20 text-amber-300 ml-1">new</span>
            )}

            <button
              onClick={onRemove}
              className="ml-auto text-xs text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              remove
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  accent
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={cn('tabular-nums', accent)}>{value}</span>
    </div>
  )
}

function DiscountModal({
  open,
  current,
  onClose,
  onApply
}: {
  open: boolean
  current: number
  onClose: () => void
  onApply: (pct: number) => void
}) {
  const [pct, setPct] = useState(String(current))

  return (
    <Modal
      open={open}
      title="Apply a discount"
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onApply(Math.max(0, Math.min(100, Number(pct) || 0)))
              onClose()
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <label className="label">Discount percent</label>
      <input
        className="field text-lg"
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        inputMode="decimal"
        autoFocus
      />
      <div className="grid grid-cols-5 gap-2 mt-3">
        {[0, 5, 10, 15, 20].map((n) => (
          <button key={n} className="btn-ghost" onClick={() => setPct(String(n))}>
            {n}%
          </button>
        ))}
      </div>
    </Modal>
  )
}
