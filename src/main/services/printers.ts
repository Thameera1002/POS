import { getDb } from '../db'
import type { Printer, Station } from '../../shared/types'

interface PrinterRow extends Omit<Printer, 'stations'> {
  stations: string
}

function hydrate(row: PrinterRow): Printer {
  let stations: Station[] = []
  try {
    const parsed = JSON.parse(row.stations)
    if (Array.isArray(parsed)) stations = parsed as Station[]
  } catch {
    // A hand-edited DB should not take the app down; an unroutable printer is
    // better than a crash at service time.
  }
  return { ...row, stations }
}

export function listPrinters(): Printer[] {
  const rows = getDb().prepare('SELECT * FROM printers ORDER BY id').all() as PrinterRow[]
  return rows.map(hydrate)
}

export function getPrinter(id: number): Printer | null {
  const row = getDb().prepare('SELECT * FROM printers WHERE id = ?').get(id) as
    | PrinterRow
    | undefined
  return row ? hydrate(row) : null
}

/** Printers that should receive tickets for a given station, in id order. */
export function printersForStation(station: Station): Printer[] {
  return listPrinters().filter((p) => p.active && p.stations.includes(station))
}

/** The printer receiving customer receipts. First active `is_receipt` wins. */
export function receiptPrinter(): Printer | null {
  return listPrinters().find((p) => p.active && p.is_receipt) ?? null
}

export type PrinterInput = Omit<Printer, 'id'>

export function createPrinter(input: PrinterInput): Printer {
  const id = Number(
    getDb()
      .prepare(
        `INSERT INTO printers (name, transport, target, port, width, stations, is_receipt, cash_drawer, copies, active)
         VALUES (@name, @transport, @target, @port, @width, @stations, @is_receipt, @cash_drawer, @copies, @active)`
      )
      .run({ ...input, stations: JSON.stringify(input.stations) }).lastInsertRowid
  )
  return getPrinter(id)!
}

export function updatePrinter(id: number, patch: Partial<PrinterInput>): Printer {
  const current = getPrinter(id)
  if (!current) throw new Error(`Printer ${id} not found`)

  const next = { ...current, ...patch }
  getDb()
    .prepare(
      `UPDATE printers SET name=@name, transport=@transport, target=@target, port=@port,
       width=@width, stations=@stations, is_receipt=@is_receipt, cash_drawer=@cash_drawer,
       copies=@copies, active=@active WHERE id=@id`
    )
    .run({ ...next, stations: JSON.stringify(next.stations), id })

  return getPrinter(id)!
}

export function deletePrinter(id: number): void {
  // Print jobs reference printers, so retire rather than delete: the audit trail
  // of what was sent where is worth keeping.
  getDb().prepare('UPDATE printers SET active = 0 WHERE id = ?').run(id)
}
