import { useState } from 'react'
import { usePos } from '../store'
import { OrderQueue } from '../components/OrderQueue'
import { CustomerModal } from '../components/CustomerModal'
import { money } from '../lib/format'

/**
 * Takeaway.
 *
 * The customer is standing at the counter, so the fast path asks for nothing:
 * one tap and you are on the menu. A name or number is only ever captured when
 * the customer asks for it — a phone order to collect later, say — and even
 * then nothing is mandatory.
 */
export function TakeawayScreen() {
  const { openOrders, openTable, loadOrder, settings } = usePos()
  const [withDetails, setWithDetails] = useState(false)

  const sym = settings?.currency_symbol ?? ''
  const queue = openOrders.filter((o) => o.order_type === 'takeaway')

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Takeaway</h1>
          <p className="text-sm text-slate-400 mt-1">
            {queue.length} in progress ·{' '}
            {money(queue.reduce((n, o) => n + o.total_cents, 0), sym)} outstanding
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4 mb-8 max-w-3xl">
        <button
          onClick={() => openTable({ order_type: 'takeaway', guest_count: 1 })}
          className="panel border-brand-500/50 bg-brand-500/10 hover:bg-brand-500/20
                     px-6 py-8 text-left transition-colors active:scale-[0.99]"
        >
          <span className="block text-2xl font-bold">New takeaway</span>
          <span className="block text-xs text-slate-400 mt-1">
            Straight to the menu. No customer details.
          </span>
        </button>

        <button
          onClick={() => setWithDetails(true)}
          className="panel hover:bg-ink-700 px-6 py-8 text-left transition-colors active:scale-[0.99]"
        >
          <span className="block text-base font-bold">With customer details</span>
          <span className="block text-xs text-slate-400 mt-1">
            Name or phone, when they ask
          </span>
        </button>
      </div>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
          In progress <span className="text-slate-600">({queue.length})</span>
        </h2>
        <OrderQueue
          orders={queue}
          symbol={sym}
          onOpen={loadOrder}
          empty="No takeaway orders in progress."
        />
      </section>

      {withDetails && (
        <CustomerModal
          open
          mode="takeaway"
          title="New takeaway"
          submitLabel="Start order"
          onClose={() => setWithDetails(false)}
          onSubmit={(d) =>
            openTable({
              order_type: 'takeaway',
              guest_count: 1,
              customer_name: d.customer_name,
              customer_phone: d.customer_phone
            })
          }
        />
      )}
    </div>
  )
}
