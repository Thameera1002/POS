import { useEffect, useState } from 'react'
import { usePos } from '../store'
import { cn, money, today } from '../lib/format'
import type { SalesReport } from '../../../shared/types'

type Shift = Awaited<ReturnType<typeof window.pos.reports.shift>>

export function ReportsScreen() {
  const { settings, toast } = usePos()
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [report, setReport] = useState<SalesReport | null>(null)
  const [shift, setShift] = useState<Shift | null>(null)

  const sym = settings?.currency_symbol ?? ''

  const load = async (f = from, t = to): Promise<void> => {
    try {
      const [sales, sh] = await Promise.all([
        window.pos.reports.sales(f, t),
        window.pos.reports.shift(t)
      ])
      setReport(sales)
      setShift(sh)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void load()
    // Loaded once on mount; the range buttons reload explicitly.
  }, [])

  const preset = (days: number): void => {
    const end = new Date()
    const start = new Date(Date.now() - days * 86400000)
    const fmt = (d: Date): string => d.toISOString().slice(0, 10)
    setFrom(fmt(start))
    setTo(fmt(end))
    void load(fmt(start), fmt(end))
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex items-end gap-2">
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
          <button className="btn-primary" onClick={() => load()}>
            Run
          </button>
          <button className="btn-ghost" onClick={() => preset(0)}>
            Today
          </button>
          <button className="btn-ghost" onClick={() => preset(7)}>
            7 days
          </button>
          <button className="btn-ghost" onClick={() => preset(30)}>
            30 days
          </button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            <Stat label="Net sales" value={money(report.net_cents, sym)} emphasis />
            <Stat label="Orders" value={String(report.order_count)} />
            <Stat
              label="Average check"
              value={money(
                report.order_count ? Math.round(report.net_cents / report.order_count) : 0,
                sym
              )}
            />
            <Stat label="Guests" value={String(report.guest_count)} />
            <Stat label="Tax collected" value={money(report.tax_cents, sym)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel title="Breakdown">
              <Line label="Gross" value={money(report.gross_cents, sym)} />
              <Line
                label="Discounts"
                value={`−${money(report.discount_cents, sym)}`}
                accent="text-amber-400"
              />
              <Line label="Service charge" value={money(report.service_charge_cents, sym)} />
              <Line label="Tax" value={money(report.tax_cents, sym)} />
              <Line label="Net" value={money(report.net_cents, sym)} bold />
            </Panel>

            <Panel title="Tenders">
              {report.by_method.length === 0 && <Empty />}
              {report.by_method.map((m) => (
                <Line
                  key={m.method}
                  label={`${m.method} (${m.count})`}
                  value={money(m.amount_cents, sym)}
                />
              ))}
            </Panel>

            <Panel title="By service type">
              {report.by_type.length === 0 && <Empty />}
              {report.by_type.map((t) => (
                <Line
                  key={t.order_type}
                  label={`${t.order_type.replace('_', ' ')} (${t.count})`}
                  value={money(t.amount_cents, sym)}
                />
              ))}
            </Panel>

            {shift && (
              <Panel title={`Drawer — ${shift.day}`}>
                <Line label="Cash expected" value={money(shift.cash_expected_cents, sym)} bold />
                <Line label="Card" value={money(shift.card_cents, sym)} />
                <Line label="Mobile / other" value={money(shift.other_cents, sym)} />
                <Line label="Checks closed" value={String(shift.order_count)} />
                <Line
                  label="Voided checks"
                  value={String(shift.void_count)}
                  accent={shift.void_count > 0 ? 'text-rose-400' : undefined}
                />
                <Line
                  label="Value of voided items"
                  value={money(shift.voided_item_cents, sym)}
                  accent={shift.voided_item_cents > 0 ? 'text-rose-400' : undefined}
                />
              </Panel>
            )}

            <Panel title="Best sellers" className="lg:col-span-2">
              {report.top_items.length === 0 && <Empty />}
              {report.top_items.map((i, idx) => {
                const max = report.top_items[0].qty || 1
                return (
                  <div key={i.name} className="py-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span>
                        <span className="text-slate-500 tabular-nums mr-2">{idx + 1}.</span>
                        {i.name}
                      </span>
                      <span className="tabular-nums text-slate-300">
                        {i.qty} · {money(i.revenue_cents, sym)}
                      </span>
                    </div>
                    {/* Bar length is relative to the top seller, so the shape of
                        the day is readable without reading every number. */}
                    <div className="mt-1 h-1.5 rounded-full bg-ink-600 overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full"
                        style={{ width: `${(i.qty / max) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </Panel>

            {report.by_hour.length > 0 && (
              <Panel title="Sales by hour" className="lg:col-span-2">
                <div className="flex items-end gap-1.5 h-36 mt-2">
                  {report.by_hour.map((h) => {
                    const max = Math.max(...report.by_hour.map((x) => x.amount_cents)) || 1
                    return (
                      <div key={h.hour} className="flex-1 flex flex-col items-center gap-1.5 group">
                        <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 tabular-nums">
                          {money(h.amount_cents, sym)}
                        </span>
                        <div
                          className="w-full bg-brand-500/70 group-hover:bg-brand-400 rounded-t transition-colors"
                          style={{ height: `${Math.max(3, (h.amount_cents / max) * 100)}%` }}
                        />
                        <span className="text-[10px] text-slate-500">{h.hour.slice(0, 2)}</span>
                      </div>
                    )
                  })}
                </div>
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  emphasis
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className={cn('panel px-4 py-4', emphasis && 'border-brand-500/50 bg-brand-500/10')}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 font-bold tabular-nums', emphasis ? 'text-2xl' : 'text-xl')}>
        {value}
      </p>
    </div>
  )
}

function Panel({
  title,
  children,
  className
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('panel px-5 py-4', className)}>
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Line({
  label,
  value,
  bold,
  accent
}: {
  label: string
  value: string
  bold?: boolean
  accent?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-1.5 text-sm',
        bold && 'border-t border-ink-600 mt-1 pt-2 font-bold'
      )}
    >
      <span className={cn('capitalize', !bold && 'text-slate-400')}>{label}</span>
      <span className={cn('tabular-nums', accent)}>{value}</span>
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-slate-500 py-2">No sales in this range.</p>
}
