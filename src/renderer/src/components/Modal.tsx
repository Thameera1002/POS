import { useEffect, type ReactNode } from 'react'
import { cn } from '../lib/format'

interface Props {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}

const WIDTH = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' }

export function Modal({ open, title, subtitle, onClose, children, footer, width = 'md' }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'panel relative w-full max-h-[88vh] flex flex-col animate-slide-up',
          WIDTH[width]
        )}
      >
        <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-ink-600">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ink-600">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
