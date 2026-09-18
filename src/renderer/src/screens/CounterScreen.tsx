import { useState } from 'react'
import { usePos } from '../store'
import { Modal } from '../components/Modal'
import { cn, elapsed, money, orderNo } from '../lib/format'
import type { OrderType } from '../../../shared/types'

/**
 * The counter — home for takeaway and delivery.
 *
 * Deliberately not the floor plan: a takeaway shop has no tables, and even in a
 * mixed venue a bag waiting on the pass has nothing to do with seating. The job
 * here is narrow — start an order fast, and see what is still unpaid or waiting
 * for collection.
 */
export function CounterScreen() {
  const { openOrders, openTable, loadOrder, settings } = usePos()
  const [newOrder, setNewOrder] = useState<OrderType | null>(null)

  const sym = settings?.currency_symbol ?? ''
  const counter = openOrders.filter((o) => o.order_type !== 'dine_in')
  const takeaway = counter.filter((o) => o.order_type === 'takeaway')
  const delivery = counter.filter((o) => o.order_type === 'delivery')

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Counter</h1>
          <p className="text-sm text-slate-400 mt-1">
            {counter.length} order{counter.length === 1 ? '' : 's'} in progress ·{' '}
            {money(counter.reduce((n, o) => n + o.total_cents, 0), sym)} outstanding
          </p>
        </div>
      </div>

      {/* One tap to start selling — the only thing that matters at a busy counter. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 max-w-3xl">
        <button
          onClick={() => openTable({ order_type: 'takeaway', guest_count: 1 })}
          className="panel border-brand-500/50 bg-brand-500/10 hover:bg-brand-500/20
                     px-6 py-7 text-left transition-colors active:scale-[0.99]"
        >
          <span className="block text-xl font-bold">New takeaway</span>
          <span className="block text-xs text-slate-400 mt-1">
            Straight to the menu — no customer details needed
          </span>
        </button>

        <button
          onClick={() => setNewOrder('delivery')}
          className="panel hover:bg-ink-700 px-6 py-7 text-left transition-colors active:scale-[0.99]"
        >
          <span className="block text-xl font-bold">New delivery</span>
          <span className="block text-xs text-slate-400 mt-1">
            Captures a name and phone number first
          </span>
        </button>
      </div>

      <Queue
        title="Takeaway"
        orders={takeaway}
        symbol={sym}
        onOpen={loadOrder}
        empty="No takeaway orders in progress."
      />
      <Queue
        title="Delivery"
        orders={delivery}
        symbol={sym}
        onOpen={loadOrder}
        empty="No deliveries in progress."
      />

      <DeliveryModal open={newOrder === 'delivery'} onClose={() => setNewOrder(null)} />
    </div>
  )
}

function Queue({
  title,
  orders,
  symbol,
  onOpen,
  empty
}: {
  title: string
  orders: ReturnType<typeof usePos.getState>['openOrders']
  symbol: string
  onOpen: (id: number) => void
  empty: string
}) {
  return (
    <section className="mb-8">
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
        {title} <span className="text-slate-600">({orders.length})</span>
      </h2>

      {orders.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => onOpen(o.id)}
              className={cn(
                'rounded-2xl border-2 p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.99]',
                o.has_unsent
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-emerald-500/60 bg-emerald-500/10'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{orderNo(o.order_number)}</span>
                {o.has_unsent === 1 ? (
                  <span className="chip bg-amber-500 text-amber-950">not sent</span>
                ) : (
                  <span className="chip bg-emerald-500/20 text-emerald-300">preparing</span>
                )}
              </div>

              {o.customer_name && (
                <p className="text-sm mt-1.5 truncate">{o.customer_name}</p>
              )}
              {o.customer_phone && (
                <p className="text-[11px] text-slate-400 font-mono">{o.customer_phone}</p>
              )}

              <p className="mt-2 text-lg font-bold tabular-nums">{money(o.total_cents, symbol)}</p>
              <p className="text-[11px] text-slate-500 mt-1">
                {o.item_count} items · {elapsed(o.opened_at)}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function DeliveryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openTable } = usePos()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  const submit = async (): Promise<void> => {
    await openTable({
      order_type: 'delivery',
      guest_count: 1,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      note: address.trim() || null
    })
    setName('')
    setPhone('')
    setAddress('')
    onClose()
  }

  return (
    <Modal
      open={open}
      title="New delivery order"
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={!phone.trim()}>
            Start order
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Customer name</label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">
            Phone <span className="text-rose-400">*required</span>
          </label>
          <input
            className="field font-mono"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+94 7X XXX XXXX"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            A delivery with no number is an order nobody can chase.
          </p>
        </div>
        <div>
          <label className="label">Address / notes</label>
          <textarea
            className="field resize-none"
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  )
}
