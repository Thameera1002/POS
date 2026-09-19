import { useState } from 'react'
import { usePos } from '../store'
import { OrderQueue } from '../components/OrderQueue'
import { CustomerModal } from '../components/CustomerModal'
import { money } from '../lib/format'

/**
 * Delivery.
 *
 * The opposite posture to takeaway: nothing starts until the driver has a
 * name, a phone number and an address. The form will not enable its button
 * without all three, and the main process rejects the order even if it did.
 */
export function DeliveryScreen() {
  const { openOrders, openTable, loadOrder, settings } = usePos()
  const [creating, setCreating] = useState(false)

  const sym = settings?.currency_symbol ?? ''
  const queue = openOrders.filter((o) => o.order_type === 'delivery')

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Delivery</h1>
          <p className="text-sm text-slate-400 mt-1">
            {queue.length} out or being made ·{' '}
            {money(queue.reduce((n, o) => n + o.total_cents, 0), sym)} outstanding
          </p>
        </div>
      </div>

      <button
        onClick={() => setCreating(true)}
        className="panel border-brand-500/50 bg-brand-500/10 hover:bg-brand-500/20
                   px-6 py-8 text-left transition-colors active:scale-[0.99] w-full max-w-3xl mb-8 block"
      >
        <span className="block text-2xl font-bold">New delivery</span>
        <span className="block text-xs text-slate-400 mt-1">
          Name, phone and address are required before the menu opens
        </span>
      </button>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
          In progress <span className="text-slate-600">({queue.length})</span>
        </h2>
        <OrderQueue
          orders={queue}
          symbol={sym}
          onOpen={loadOrder}
          empty="No deliveries in progress."
        />
      </section>

      {creating && (
        <CustomerModal
          open
          mode="delivery"
          title="New delivery"
          submitLabel="Start order"
          onClose={() => setCreating(false)}
          onSubmit={(d) =>
            openTable({
              order_type: 'delivery',
              guest_count: 1,
              customer_name: d.customer_name,
              customer_phone: d.customer_phone,
              delivery_address: d.delivery_address
            })
          }
        />
      )}
    </div>
  )
}
