import { useState } from 'react'
import { usePos } from '../store'
import { Modal } from './Modal'
import { cn } from '../lib/format'

const KIND_LABEL: Record<string, string> = {
  kitchen: 'Kitchen ticket',
  void: 'Cancellation',
  receipt: 'Customer receipt',
  test: 'Test print'
}

/**
 * The on-screen paper.
 *
 * Printers configured with the `preview` transport route their tickets here
 * instead of to hardware, which means the entire kitchen-printing flow —
 * station routing, rounds, voids, receipts — is demonstrable and testable on a
 * laptop with nothing plugged in. It doubles as the "what exactly did the
 * kitchen get?" view when something goes wrong on a real printer.
 */
export function TicketPreview() {
  const { preview, showPreview } = usePos()
  const [active, setActive] = useState(0)

  const tickets = preview ?? []
  const current = tickets[Math.min(active, tickets.length - 1)]

  const close = (): void => {
    showPreview(null)
    setActive(0)
  }

  return (
    <Modal
      open={tickets.length > 0}
      title={tickets.length > 1 ? `${tickets.length} tickets` : (KIND_LABEL[current?.kind ?? ''] ?? 'Ticket')}
      subtitle="Preview mode — assign a real printer in Settings → Printers to send this to paper"
      onClose={close}
      width="md"
      footer={
        <button className="btn-primary" onClick={close}>
          Done
        </button>
      }
    >
      {tickets.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {tickets.map((t, i) => (
            <button
              key={`${t.job_id}-${i}`}
              onClick={() => setActive(i)}
              className={cn(
                'btn text-xs px-3 min-h-[36px]',
                i === active ? 'bg-brand-500 text-white' : 'bg-ink-600 text-slate-300'
              )}
            >
              {t.printer_name}
              {!t.ok && <span className="text-rose-300">⚠</span>}
            </button>
          ))}
        </div>
      )}

      {current && (
        <>
          <div className="flex items-center justify-between mb-3 text-xs">
            <span className="chip bg-ink-600 text-slate-300">
              {KIND_LABEL[current.kind] ?? current.kind}
            </span>
            <span className={cn('chip', current.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300')}>
              {current.ok ? `sent → ${current.printer_name}` : 'failed'}
            </span>
          </div>

          {!current.ok && current.error && (
            <p className="mb-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {current.error}
            </p>
          )}

          {/* Torn-paper framing so it reads as a receipt, not a code block. */}
          <div className="bg-[#fdfdf8] rounded-md shadow-lg">
            <div className="h-2 bg-[#fdfdf8] rounded-t-md [mask-image:repeating-linear-gradient(90deg,#000_0_6px,transparent_6px_12px)]" />
            <div className="receipt-paper">{current.preview}</div>
            <div className="h-2 bg-[#fdfdf8] rounded-b-md [mask-image:repeating-linear-gradient(90deg,#000_0_6px,transparent_6px_12px)]" />
          </div>
        </>
      )}
    </Modal>
  )
}
