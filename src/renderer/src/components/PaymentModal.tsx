import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { usePos } from '../store'
import { cn, money, toCents } from '../lib/format'
import type { Order, PaymentMethod } from '../../../shared/types'

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'other', label: 'Other' }
]

/**
 * Tender screen. Handles the two things that actually happen at a till:
 * a straight full payment, and a split across methods or people.
 *
 * Cash keeps `tendered` separate from `amount` so change is computed and
 * printed rather than done in someone's head.
 */
export function PaymentModal({
  order,
  onClose
}: {
  order: Order | null
  onClose: () => void
}) {
  const { pay, removePayment, settings, busy } = usePos()
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')

  const due = order?.totals.due_cents ?? 0
  const sym = settings?.currency_symbol ?? ''

  // Blank amount means "settle the whole balance" — the overwhelmingly common
  // case, so it should need zero typing.
  const amountCents = amount.trim() ? Math.min(toCents(amount), due) : due
  const tenderedCents = tendered.trim() ? toCents(tendered) : amountCents
  const change = Math.max(0, tenderedCents - amountCents)

  /** Round the balance up to handy notes, the way a cashier actually takes cash. */
  const quickCash = useMemo(() => {
    const notes = [50000, 100000, 200000, 500000, 1000000, 2000000, 500, 1000, 2000, 5000]
    const set = new Set<number>([due])
    for (const n of [100, 500, 1000, 2000, 5000, 10000]) {
      const up = Math.ceil(due / n) * n
      if (up > due) set.add(up)
    }
    for (const n of notes) if (n > due) set.add(n)
    return [...set].sort((a, b) => a - b).slice(0, 6)
  }, [due])

  if (!order) return null

  const submit = async (): Promise<void> => {
    if (amountCents <= 0) return
    await pay({
      method,
      amount_cents: amountCents,
      tendered_cents: method === 'cash' ? tenderedCents : null,
      reference: reference.trim() || null
    })
    setAmount('')
    setTendered('')
    setReference('')
    // Keep the sheet open on a split so the next tender can go straight in.
    if (amountCents >= due) onClose()
  }

  return (
    <Modal
      open
      title="Take payment"
      subtitle={`Order ${order.order_number} · ${money(order.totals.total_cents, sym)} total`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="btn-success min-w-[200px]"
            onClick={submit}
            disabled={busy || amountCents <= 0 || (method === 'cash' && tenderedCents < amountCents)}
          >
            {amountCents >= due
              ? `Settle ${money(amountCents, sym)}`
              : `Pay ${money(amountCents, sym)} of ${money(due, sym)}`}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="panel bg-ink-700/60 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-slate-400">Balance due</span>
          <span className="text-3xl font-bold tabular-nums">{money(due, sym)}</span>
        </div>

        <div>
          <label className="label">Method</label>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMethod(m.key)}
                className={cn(
                  'btn',
                  method === m.key ? 'bg-brand-500 text-white' : 'bg-ink-600 text-slate-300'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Amount</label>
            <input
              className="field text-lg tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={money(due)}
              inputMode="decimal"
            />
            <p className="mt-1.5 text-[11px] text-slate-500">Leave blank to settle in full.</p>
          </div>

          {method === 'cash' ? (
            <div>
              <label className="label">Cash tendered</label>
              <input
                className="field text-lg tabular-nums"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                placeholder={money(amountCents)}
                inputMode="decimal"
              />
              {change > 0 && (
                <p className="mt-1.5 text-sm font-bold text-emerald-400">
                  Change {money(change, sym)}
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="label">Reference</label>
              <input
                className="field"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Auth code / last 4"
              />
            </div>
          )}
        </div>

        {method === 'cash' && (
          <div>
            <label className="label">Quick cash</label>
            <div className="grid grid-cols-3 gap-2">
              {quickCash.map((c) => (
                <button
                  key={c}
                  className="btn-ghost tabular-nums"
                  onClick={() => setTendered((c / 100).toFixed(2))}
                >
                  {money(c, sym)}
                </button>
              ))}
            </div>
          </div>
        )}

        {order.payments.length > 0 && (
          <div>
            <label className="label">Tenders taken</label>
            <div className="space-y-2">
              {order.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl bg-ink-700 px-3 py-2.5 text-sm"
                >
                  <span className="capitalize">{p.method}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">
                      {money(p.amount_cents, sym)}
                    </span>
                    <button
                      onClick={() => removePayment(p.id)}
                      className="text-xs text-rose-400 hover:text-rose-300"
                    >
                      remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
