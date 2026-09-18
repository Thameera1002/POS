import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { getSettings } from '../services/settings'
import { printersForStation, receiptPrinter, getPrinter } from '../services/printers'
import { send } from './transports'
import { kitchenTicket, voidTicket, receipt, testTicket } from './templates'
import type {
  Order,
  OrderItem,
  PrintJob,
  PrintResult,
  Printer,
  Station,
  TicketKind
} from '../../shared/types'
import { EscPos } from './escpos'

/**
 * Turns an order into paper.
 *
 * Every ticket becomes a row in `print_jobs` *before* it is sent, so a printer
 * that is off, jammed or unplugged leaves a failed job the cashier can see and
 * retry — rather than a ticket that silently never reached the kitchen. That
 * single property is the difference between a POS you can trust at 8pm on a
 * Saturday and one you cannot.
 */

/** Broadcast so the renderer can pop a preview window / show a toast. */
function notify(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function enqueue(
  printer: Printer,
  kind: TicketKind,
  orderId: number | null,
  doc: EscPos
): { jobId: number; preview: string; payload: Buffer } {
  const preview = doc.toText()
  const payload = doc.build()
  const jobId = Number(
    getDb()
      .prepare(
        `INSERT INTO print_jobs (printer_id, order_id, kind, status, preview, payload)
         VALUES (?, ?, ?, 'queued', ?, ?)`
      )
      .run(printer.id, orderId, kind, preview, payload).lastInsertRowid
  )
  return { jobId, preview, payload }
}

async function dispatch(
  printer: Printer,
  kind: TicketKind,
  orderId: number | null,
  doc: EscPos
): Promise<PrintResult> {
  const { jobId, preview, payload } = enqueue(printer, kind, orderId, doc)
  const db = getDb()

  db.prepare("UPDATE print_jobs SET status='printing', attempts = attempts + 1 WHERE id = ?").run(
    jobId
  )

  const base: Omit<PrintResult, 'ok' | 'error'> = {
    printer_id: printer.id,
    printer_name: printer.name,
    kind,
    preview,
    job_id: jobId
  }

  try {
    for (let copy = 0; copy < Math.max(1, printer.copies); copy++) {
      await send(printer, payload)
    }
    db.prepare("UPDATE print_jobs SET status='done', error=NULL WHERE id = ?").run(jobId)

    // With no hardware attached the ticket still has to go somewhere visible,
    // or the operator has no idea whether the kitchen was told.
    if (printer.transport === 'preview') {
      notify('print:preview', { ...base, ok: true })
    }
    return { ...base, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE print_jobs SET status='failed', error=? WHERE id = ?").run(message, jobId)
    console.error(`[print] ${printer.name} failed: ${message}`)
    notify('print:failed', { ...base, ok: false, error: message })
    return { ...base, ok: false, error: message }
  }
}

/**
 * Fires the order's pending items at the kitchen.
 *
 * Items are grouped by station and each group goes only to the printers that
 * serve that station — so the bar never prints the steaks and the grill never
 * prints the mojitos. A single order routinely produces two or three tickets.
 *
 * Marking items `fired` is the caller's job (see `services/orders.fireOrder`),
 * which does it in the same transaction that decides *what* to fire.
 */
export async function printKitchenTickets(
  order: Order,
  items: OrderItem[],
  round: number,
  opts: { reprint?: boolean } = {}
): Promise<PrintResult[]> {
  const byStation = groupByStation(items)
  const results: PrintResult[] = []

  for (const [station, group] of byStation) {
    const targets = printersForStation(station)

    if (!targets.length) {
      // Nothing routes this station. Surfacing it is essential: silently not
      // printing food is how orders get lost.
      results.push({
        printer_id: -1,
        printer_name: `(no printer for ${station})`,
        kind: 'kitchen',
        ok: false,
        error: `No active printer is assigned to the "${station}" station. Assign one in Settings → Printers.`,
        preview: kitchenTicket(order, group, station, round, 42, opts).toText(),
        job_id: -1
      })
      continue
    }

    for (const printer of targets) {
      const doc = kitchenTicket(order, group, station, round, printer.width, opts)
      results.push(await dispatch(printer, 'kitchen', order.id, doc))
    }
  }

  return results
}

/** Tells the stations to stop making items that were fired and then removed. */
export async function printVoidTickets(
  order: Order,
  items: OrderItem[]
): Promise<PrintResult[]> {
  const results: PrintResult[] = []

  for (const [station, group] of groupByStation(items)) {
    for (const printer of printersForStation(station)) {
      const doc = voidTicket(order, group, station, printer.width)
      results.push(await dispatch(printer, 'void', order.id, doc))
    }
  }
  return results
}

export async function printReceipt(
  order: Order,
  opts: { reprint?: boolean } = {}
): Promise<PrintResult[]> {
  const printer = receiptPrinter()
  const settings = getSettings()

  if (!printer) {
    return [
      {
        printer_id: -1,
        printer_name: '(no receipt printer)',
        kind: 'receipt',
        ok: false,
        error: 'No receipt printer configured. Set one in Settings → Printers.',
        preview: receipt(order, settings, 48, opts).toText(),
        job_id: -1
      }
    ]
  }

  const doc = receipt(order, settings, printer.width, {
    ...opts,
    drawer: Boolean(printer.cash_drawer) && order.payments.some((p) => p.method === 'cash')
  })
  return [await dispatch(printer, 'receipt', order.id, doc)]
}

export async function printTest(printerId: number): Promise<PrintResult> {
  const printer = getPrinter(printerId)
  if (!printer) throw new Error(`Printer ${printerId} not found`)
  return dispatch(printer, 'test', null, testTicket(printer.name, printer.width))
}

/** Opens the drawer without a sale — for a float drop or a manual no-sale. */
export async function openDrawer(): Promise<PrintResult> {
  const printer = receiptPrinter()
  if (!printer) throw new Error('No receipt printer configured')

  const doc = new EscPos(printer.width)
  doc.kickDrawer()
  return dispatch(printer, 'test', null, doc)
}

/* ---------- job queue ---------- */

export function listJobs(limit = 50): PrintJob[] {
  return getDb()
    .prepare(
      `SELECT j.id, j.printer_id, p.name AS printer_name, j.order_id, j.kind, j.status,
              j.attempts, j.error, j.preview, j.created_at
       FROM print_jobs j JOIN printers p ON p.id = j.printer_id
       ORDER BY j.id DESC LIMIT ?`
    )
    .all(limit) as PrintJob[]
}

export function failedJobCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM print_jobs WHERE status = 'failed'")
    .get() as { n: number }
  return row.n
}

/** Re-sends a stored job byte-for-byte. Used by the retry button and reprints. */
export async function retryJob(jobId: number): Promise<PrintResult> {
  const row = getDb()
    .prepare('SELECT printer_id, order_id, kind, preview, payload FROM print_jobs WHERE id = ?')
    .get(jobId) as
    | { printer_id: number; order_id: number | null; kind: TicketKind; preview: string; payload: Buffer }
    | undefined

  if (!row) throw new Error(`Print job ${jobId} not found`)
  const printer = getPrinter(row.printer_id)
  if (!printer) throw new Error('The printer for this job no longer exists')

  const db = getDb()
  db.prepare("UPDATE print_jobs SET status='printing', attempts = attempts + 1 WHERE id = ?").run(
    jobId
  )

  const base = {
    printer_id: printer.id,
    printer_name: printer.name,
    kind: row.kind,
    preview: row.preview,
    job_id: jobId
  }

  try {
    await send(printer, row.payload)
    db.prepare("UPDATE print_jobs SET status='done', error=NULL WHERE id = ?").run(jobId)
    if (printer.transport === 'preview') notify('print:preview', { ...base, ok: true })
    return { ...base, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE print_jobs SET status='failed', error=? WHERE id = ?").run(message, jobId)
    return { ...base, ok: false, error: message }
  }
}

/** Retries every failed job oldest-first, so the kitchen gets them in order. */
export async function retryAllFailed(): Promise<PrintResult[]> {
  const ids = getDb()
    .prepare("SELECT id FROM print_jobs WHERE status='failed' ORDER BY id")
    .all() as { id: number }[]

  const results: PrintResult[] = []
  for (const { id } of ids) results.push(await retryJob(id))
  return results
}

/* ---------- helpers ---------- */

/**
 * Groups items by station, preserving the order the items were added so a
 * ticket reads in the sequence the server took the order.
 */
function groupByStation(items: OrderItem[]): Map<Station, OrderItem[]> {
  const map = new Map<Station, OrderItem[]>()
  for (const item of items) {
    const station = item.station === 'none' ? 'kitchen' : item.station
    const bucket = map.get(station)
    bucket ? bucket.push(item) : map.set(station, [item])
  }
  return map
}
