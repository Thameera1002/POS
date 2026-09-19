import { useEffect, useState } from 'react'
import { usePos, type Screen } from './store'
import { FloorScreen } from './screens/FloorScreen'
import { TakeawayScreen } from './screens/TakeawayScreen'
import { DeliveryScreen } from './screens/DeliveryScreen'
import { OrderScreen } from './screens/OrderScreen'
import { OrdersScreen } from './screens/OrdersScreen'
import { MenuScreen } from './screens/MenuScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Toasts } from './components/Toasts'
import { TicketPreview } from './components/TicketPreview'
import { cn } from './lib/format'

const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: 'floor', label: 'Floor', icon: '▦' },
  { key: 'takeaway', label: 'Takeaway', icon: '▧' },
  { key: 'delivery', label: 'Delivery', icon: '➤' },
  { key: 'orders', label: 'Orders', icon: '☰' },
  { key: 'menu', label: 'Menu', icon: '✎' },
  { key: 'reports', label: 'Reports', icon: '▤' },
  { key: 'settings', label: 'Settings', icon: '⚙' }
]

export default function App() {
  const {
    ready,
    screen,
    go,
    bootstrap,
    activeOrder,
    openOrders,
    refreshOpenOrders,
    settings
  } = usePos()
  const [failedPrints, setFailedPrints] = useState(0)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const mode = settings?.service_mode ?? 'both'

  // A takeaway-only venue has no tables, so the floor plan is dead weight; a
  // dine-in-only one never needs the takeaway or delivery queues. Hiding the
  // irrelevant screen beats showing an empty one.
  const nav = NAV.filter((n) => {
    if (n.key === 'floor') return mode !== 'takeaway'
    if (n.key === 'takeaway' || n.key === 'delivery') return mode !== 'dine_in'
    return true
  })

  const count = (type: string): number => openOrders.filter((o) => o.order_type === type).length
  const badges: Partial<Record<Screen, number>> = {
    floor: count('dine_in'),
    takeaway: count('takeaway'),
    delivery: count('delivery')
  }
  // Keep the tab the open order belongs to lit while editing it.
  const activeOrderHome: Screen =
    activeOrder?.order_type === 'dine_in'
      ? 'floor'
      : activeOrder?.order_type === 'delivery'
        ? 'delivery'
        : 'takeaway'

  // Land on whichever home this venue uses once settings have loaded.
  useEffect(() => {
    if (!ready) return
    if (mode === 'takeaway' && screen === 'floor') go('takeaway')
    if (mode === 'dine_in' && (screen === 'takeaway' || screen === 'delivery')) go('floor')
  }, [ready, mode, screen, go])

  // Keep the queue views honest while on screen: another terminal or a
  // long-running check should not leave stale totals sitting in front of staff.
  useEffect(() => {
    if (screen !== 'floor' && screen !== 'takeaway' && screen !== 'delivery') return
    const id = setInterval(() => void refreshOpenOrders(), 20000)
    return () => clearInterval(id)
  }, [screen, refreshOpenOrders])

  useEffect(() => {
    const poll = (): void => {
      void window.pos.print.failedCount().then(setFailedPrints).catch(() => {})
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [])

  if (!ready) {
    return (
      <div className="h-full grid place-items-center">
        <p className="text-sm text-slate-500">Starting up…</p>
      </div>
    )
  }

  return (
    <div className="h-full flex">
      <nav className="w-[88px] shrink-0 bg-ink-900 border-r border-ink-600 flex flex-col items-center py-4 gap-2">
        <div className="h-10 w-10 rounded-xl bg-brand-500 grid place-items-center font-bold text-lg mb-4 mt-6">
          S
        </div>

        {nav.map((n) => (
          <button
            key={n.key}
            onClick={() => go(n.key)}
            className={cn(
              'relative w-[68px] py-3 rounded-xl flex flex-col items-center gap-1 transition-colors',
              screen === n.key || (n.key === activeOrderHome && screen === 'order')
                ? 'bg-ink-700 text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-ink-800'
            )}
          >
            <span className="text-lg leading-none">{n.icon}</span>
            <span className="text-[10px] font-semibold">{n.label}</span>

            {(badges[n.key] ?? 0) > 0 && (
              <span className="absolute top-1.5 right-2 chip bg-brand-500 text-white px-1.5">
                {badges[n.key]}
              </span>
            )}
            {/* An unnoticed failed kitchen ticket is a lost order, so the badge
                follows the operator across every screen. */}
            {n.key === 'settings' && failedPrints > 0 && (
              <span className="absolute top-1.5 right-2 chip bg-rose-500 text-white px-1.5">
                {failedPrints}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main className="flex-1 min-w-0">
        {screen === 'order' && activeOrder ? (
          <OrderScreen />
        ) : screen === 'takeaway' ? (
          <TakeawayScreen />
        ) : screen === 'delivery' ? (
          <DeliveryScreen />
        ) : screen === 'orders' ? (
          <OrdersScreen />
        ) : screen === 'menu' ? (
          <MenuScreen />
        ) : screen === 'reports' ? (
          <ReportsScreen />
        ) : screen === 'settings' ? (
          <SettingsScreen />
        ) : (
          <FloorScreen />
        )}
      </main>

      <Toasts />
      <TicketPreview />
    </div>
  )
}
