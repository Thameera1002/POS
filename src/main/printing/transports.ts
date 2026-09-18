import net from 'node:net'
import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Printer } from '../../shared/types'

/**
 * Sends a finished ESC/POS buffer to a physical printer.
 *
 * Three transports cover every realistic restaurant setup:
 *  - `tcp`     — LAN thermal printer on raw port 9100 (JetDirect). The standard
 *                for kitchen printers, because they need to live on the wall
 *                near the pass, not cabled to the till.
 *  - `cups`    — a USB/Bluetooth printer installed in the OS print queue, fed
 *                raw bytes via `lp -o raw` so the driver does not re-render it.
 *  - `preview` — no hardware; the caller shows the ticket on screen instead.
 */
export async function send(printer: Printer, payload: Buffer): Promise<void> {
  switch (printer.transport) {
    case 'tcp':
      return sendTcp(printer.target, printer.port, payload)
    case 'cups':
      return sendCups(printer.target, payload)
    case 'preview':
      return
    default:
      throw new Error(`Unknown transport: ${printer.transport}`)
  }
}

/** Hard ceiling on a single print attempt; a wedged printer must not hang a sale. */
const TCP_TIMEOUT_MS = 5000

function sendTcp(host: string, port: number, payload: Buffer): Promise<void> {
  if (!host) return Promise.reject(new Error('Printer has no IP address configured'))

  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      err ? reject(err) : resolve()
    }

    socket.setTimeout(TCP_TIMEOUT_MS)
    socket.once('timeout', () => finish(new Error(`Timed out connecting to ${host}:${port}`)))
    socket.once('error', (err) => finish(new Error(`${host}:${port} — ${err.message}`)))

    socket.connect(port, host, () => {
      // Wait for the kernel to flush before tearing the socket down, or the
      // printer can receive a truncated ticket.
      socket.end(payload, () => finish())
    })
  })
}

async function sendCups(queue: string, payload: Buffer): Promise<void> {
  if (!queue) throw new Error('Printer has no CUPS queue name configured')

  const file = join(tmpdir(), `pos-ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
  await writeFile(file, payload)

  try {
    await run('lp', ['-d', queue, '-o', 'raw', file])
  } finally {
    await unlink(file).catch(() => {})
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `${cmd} exited ${code}`))
    )
  })
}

/** Lists OS print queues so Settings can offer them instead of free typing. */
export async function listCupsQueues(): Promise<string[]> {
  if (process.platform === 'win32') return []
  return new Promise((resolve) => {
    const child = spawn('lpstat', ['-a'])
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.once('error', () => resolve([]))
    child.once('close', () =>
      resolve(
        out
          .split('\n')
          .map((l) => l.trim().split(/\s+/)[0])
          .filter(Boolean)
      )
    )
  })
}
