import { usePos } from '../store'
import { cn } from '../lib/format'

const STYLE = {
  info: 'border-brand-500/40 bg-brand-500/10',
  success: 'border-emerald-500/40 bg-emerald-500/10',
  error: 'border-rose-500/50 bg-rose-500/10'
}

const ICON = { info: 'ℹ', success: '✓', error: '!' }

export function Toasts() {
  const { toasts, dismiss, showPreview } = usePos()

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[380px]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'panel border animate-slide-up px-4 py-3 flex items-start gap-3',
            STYLE[t.kind]
          )}
        >
          <span
            className={cn(
              'mt-0.5 h-5 w-5 shrink-0 rounded-full grid place-items-center text-xs font-bold',
              t.kind === 'error'
                ? 'bg-rose-500 text-white'
                : t.kind === 'success'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-brand-500 text-white'
            )}
          >
            {ICON[t.kind]}
          </span>

          <div className="flex-1 min-w-0">
            <p className="text-sm leading-snug">{t.message}</p>

            {t.prints && t.prints.length > 0 && (
              <button
                onClick={() => showPreview(t.prints ?? null)}
                className="mt-1.5 text-xs font-semibold text-brand-400 hover:text-brand-300"
              >
                View ticket{t.prints.length > 1 ? `s (${t.prints.length})` : ''}
              </button>
            )}
          </div>

          <button
            onClick={() => dismiss(t.id)}
            className="text-slate-400 hover:text-slate-100 text-lg leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
