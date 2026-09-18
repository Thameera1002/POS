/** Formatting helpers. Money arrives from the main process as integer cents. */

export function money(cents: number, symbol = ''): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${symbol}${whole}.${frac}`
}

/** Parses a typed amount ("12.50", "12,50", "12") into integer cents. */
export function toCents(input: string): number {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(',', '.')
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) : 0
}

export function orderNo(n: number): string {
  return `#${String(n).padStart(4, '0')}`
}

/** SQLite stores UTC 'YYYY-MM-DD HH:MM:SS'; render it in the till's timezone. */
export function clock(sqlDate: string): string {
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime())
    ? sqlDate
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** How long a check has been open — the number a floor manager watches. */
export function elapsed(sqlDate: string): string {
  const then = new Date(sqlDate.replace(' ', 'T') + 'Z').getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
