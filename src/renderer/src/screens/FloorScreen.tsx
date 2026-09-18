import { useMemo, useState } from 'react'
import { usePos } from '../store'
import { Modal } from '../components/Modal'
import { cn, elapsed, money, orderNo } from '../lib/format'
import type { OrderSummary, OrderType } from '../../../shared/types'

/**
 * The floor plan — the screen staff live on.
 *
 * Tables are grouped by zone and colour-coded by state, so the one thing a
 * manager needs at a glance ("which tables have food the kitchen hasn't seen
 * yet?") is visible without opening a single check.
 */
export function FloorScreen() {
  const { tables, openOrders, openTable, loadOrder, settings } = usePos()
  const [walkIn, setWalkIn] = useState<OrderType | null>(null)

  const byTable = useMemo(() => {
    const map = new Map<string, OrderSummary>()
    for (const o of openOrders) if (o.table_name) map.set(o.table_name, o)
    return map
  }, [openOrders])

  const zones = useMemo(() => {
    const map = new Map<string, typeof tables>()
    for (const t of tables) {
      const bucket = map.get(t.zone)
      bucket ? bucket.push(t) : map.set(t.zone, [t])
    }
    return [...map]
  }, [tables])

  // Takeaway and delivery live on the Counter screen, not here. A bag waiting on
  // the pass has nothing to do with seating, and mixing them made the floor plan
  // useless for the one question it exists to answer: which tables need me?
  const dineIn = openOrders.filter((o) => o.order_type === 'dine_in')
  const sym = settings?.currency_symbol ?? ''

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Floor</h1>
          <p className="text-sm text-slate-400 mt-1">
            {dineIn.length} open check{dineIn.length === 1 ? '' : 's'} ·{' '}
            {money(dineIn.reduce((n, o) => n + o.total_cents, 0), sym)} on the floor
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn-ghost" onClick={() => setWalkIn('takeaway')}>
            + Takeaway
          </button>
        </div>
      </div>

      <Legend />

      {zones.map(([zone, list]) => (
        <section key={zone} className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
            {zone}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {list.map((table) => {
              const order = byTable.get(table.name)
              return (
                <button
                  key={table.id}
                  onClick={() =>
                    order
                      ? loadOrder(order.id)
                      : openTable({
                          order_type: 'dine_in',
                          table_id: table.id,
                          guest_count: table.seats
                        })
                  }
                  className={cn(
                    'relative rounded-2xl border-2 p-4 text-left transition-all min-h-[118px]',
                    'hover:scale-[1.02] active:scale-[0.99]',
                    !order && 'border-ink-600 bg-ink-800 hover:border-ink-500',
                    order && order.has_unsent
                      ? 'border-amber-500 bg-amber-500/10'
                      : order && 'border-emerald-500/70 bg-emerald-500/10'
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-bold">{table.name}</span>
                    <span className="text-[11px] text-slate-500">{table.seats}p</span>
                  </div>

                  {order ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-slate-400">
                        {orderNo(order.order_number)} · {order.item_count} items
                      </p>
                      <p className="text-lg font-bold tabular-nums">
                        {money(order.total_cents, sym)}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">
                          {elapsed(order.opened_at)}
                        </span>
                        {order.has_unsent === 1 && (
                          <span className="chip bg-amber-500 text-amber-950">not sent</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">Tap to open</p>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <WalkInModal type={walkIn} onClose={() => setWalkIn(null)} />
    </div>
  )
}

function Legend() {
  const items = [
    ['border-ink-600 bg-ink-800', 'Free'],
    ['border-emerald-500/70 bg-emerald-500/10', 'Open, sent to kitchen'],
    ['border-amber-500 bg-amber-500/10', 'Items not yet sent']
  ] as const

  return (
    <div className="flex flex-wrap gap-5 mb-6 text-xs text-slate-400">
      {items.map(([klass, label]) => (
        <span key={label} className="flex items-center gap-2">
          <span className={cn('h-3.5 w-3.5 rounded border-2', klass)} />
          {label}
        </span>
      ))}
    </div>
  )
}

function WalkInModal({ type, onClose }: { type: OrderType | null; onClose: () => void }) {
  const { openTable } = usePos()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const submit = async (): Promise<void> => {
    if (!type) return
    // A delivery with no phone number is an order nobody can chase.
    await openTable({
      order_type: type,
      guest_count: 1,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null
    })
    setName('')
    setPhone('')
    onClose()
  }

  return (
    <Modal
      open={type !== null}
      title={type === 'delivery' ? 'New delivery order' : 'New takeaway order'}
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={type === 'delivery' && !phone.trim()}
          >
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
            placeholder="Optional"
            autoFocus
          />
        </div>
        <div>
          <label className="label">
            Phone {type === 'delivery' && <span className="text-rose-400">*required</span>}
          </label>
          <input
            className="field"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+94 7X XXX XXXX"
          />
        </div>
      </div>
    </Modal>
  )
}
