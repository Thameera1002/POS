import { cn, elapsed, money, orderNo } from '../lib/format'
import type { OrderSummary } from '../../../shared/types'

/**
 * Cards for orders in progress — shared by the takeaway and delivery screens.
 * Amber means the kitchen has not been told yet; green means it is being made.
 */
export function OrderQueue({
  orders,
  symbol,
  onOpen,
  empty
}: {
  orders: OrderSummary[]
  symbol: string
  onOpen: (id: number) => void
  empty: string
}) {
  if (orders.length === 0) {
    return <p className="text-sm text-slate-500">{empty}</p>
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {orders.map((o) => (
        <button
          key={o.id}
          onClick={() => onOpen(o.id)}
          className={cn(
            'rounded-2xl border-2 p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.99]',
            o.has_unsent ? 'border-amber-500 bg-amber-500/10' : 'border-emerald-500/60 bg-emerald-500/10'
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

          {o.customer_name && <p className="text-sm mt-1.5 truncate">{o.customer_name}</p>}
          {o.customer_phone && (
            <p className="text-[11px] text-slate-400 font-mono">{o.customer_phone}</p>
          )}
          {o.delivery_address && (
            <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{o.delivery_address}</p>
          )}

          <p className="mt-2 text-lg font-bold tabular-nums">{money(o.total_cents, symbol)}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {o.item_count} items · {elapsed(o.opened_at)}
          </p>
        </button>
      ))}
    </div>
  )
}
