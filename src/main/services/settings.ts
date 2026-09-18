import { getDb } from '../db'
import type { Settings } from '../../shared/types'

const NUMERIC: (keyof Settings)[] = [
  'tax_pct',
  'service_charge_pct',
  'auto_print_receipt',
  'takeaway_pay_first'
]

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]

  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const out: Record<string, string | number> = { ...raw }
  for (const key of NUMERIC) out[key] = Number(raw[key] ?? 0)

  return out as unknown as Settings
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      stmt.run(k, String(v))
    }
  })()
  return getSettings()
}
