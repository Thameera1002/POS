import { useEffect, useState } from 'react'
import { usePos } from '../store'
import { Modal } from '../components/Modal'
import { cn } from '../lib/format'
import {
  STATIONS,
  type Printer,
  type PrinterTransport,
  type ServiceMode,
  type Station
} from '../../../shared/types'
import type { PrintJob } from '../../../shared/types'

type Tab = 'restaurant' | 'printers' | 'jobs'

export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('printers')

  const tabs: [Tab, string][] = [
    ['printers', 'Printers & stations'],
    ['restaurant', 'Restaurant'],
    ['jobs', 'Print log']
  ]

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 pt-6 pb-0">
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <div className="flex gap-2 border-b border-ink-600">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors',
                tab === key
                  ? 'border-brand-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {tab === 'printers' && <PrintersTab />}
        {tab === 'restaurant' && <RestaurantTab />}
        {tab === 'jobs' && <JobsTab />}
      </div>
    </div>
  )
}

/* ---------- printers ---------- */

const TRANSPORT_HELP: Record<PrinterTransport, string> = {
  tcp: 'Network thermal printer on raw port 9100. The normal choice for a printer mounted at the pass.',
  cups: 'A printer installed in this computer’s print queues (USB or Bluetooth). Bytes are sent raw, bypassing the driver.',
  preview: 'No hardware. Tickets open on screen instead — use this to test the flow before the printers arrive.'
}

function PrintersTab() {
  const { printers, refreshPrinters, toast, showPreview } = usePos()
  const [editing, setEditing] = useState<Printer | 'new' | null>(null)

  /**
   * Stations with no printer are the single most dangerous misconfiguration in
   * a restaurant POS: orders for that station are taken and never cooked. Call
   * it out loudly, right at the top.
   */
  const unrouted = STATIONS.filter(
    (s) => !printers.some((p) => p.active && p.stations.includes(s))
  )
  const noReceipt = !printers.some((p) => p.active && p.is_receipt)

  const test = async (id: number): Promise<void> => {
    try {
      const result = await window.pos.printers.test(id)
      result.ok
        ? toast('success', `Test sent to ${result.printer_name}`, [result])
        : toast('error', `${result.printer_name}: ${result.error}`, [result])
      if (result.ok) showPreview([result])
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      {(unrouted.length > 0 || noReceipt) && (
        <div className="panel border-amber-500/40 bg-amber-500/10 px-5 py-4">
          <p className="text-sm font-semibold text-amber-200">Routing gaps</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-100/80 list-disc list-inside">
            {unrouted.map((s) => (
              <li key={s}>
                Nothing prints the <strong>{s}</strong> station — items sent there will never
                reach a cook.
              </li>
            ))}
            {noReceipt && <li>No receipt printer is set, so bills cannot be printed.</li>}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Each menu item belongs to a station. When an order is sent to the kitchen, its items are
          split by station and routed to the printers below.
        </p>
        <button className="btn-primary shrink-0 ml-4" onClick={() => setEditing('new')}>
          + Printer
        </button>
      </div>

      <div className="space-y-3">
        {printers.map((p) => (
          <div
            key={p.id}
            className={cn('panel px-5 py-4', !p.active && 'opacity-45')}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold">{p.name}</h3>
                  <span className="chip bg-ink-600 text-slate-300">{p.transport}</span>
                  {p.is_receipt === 1 && (
                    <span className="chip bg-brand-500/20 text-brand-300">receipts</span>
                  )}
                  {p.cash_drawer === 1 && (
                    <span className="chip bg-emerald-500/20 text-emerald-300">drawer</span>
                  )}
                  {!p.active && <span className="chip bg-ink-600 text-slate-500">retired</span>}
                </div>

                <p className="text-xs text-slate-400 mt-1.5 font-mono">
                  {p.transport === 'tcp'
                    ? `${p.target || '(no IP)'}:${p.port}`
                    : p.transport === 'cups'
                      ? p.target || '(no queue)'
                      : 'on-screen preview'}{' '}
                  · {p.width} cols · ×{p.copies}
                </p>

                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {p.stations.length ? (
                    p.stations.map((s) => (
                      <span key={s} className="chip bg-ink-600 text-slate-300">
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-500">no stations routed here</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <button className="btn-ghost text-xs" onClick={() => test(p.id)}>
                  Test
                </button>
                <button className="btn-ghost text-xs" onClick={() => setEditing(p)}>
                  Edit
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel px-5 py-4">
        <p className="text-sm font-semibold mb-1">Cash drawer</p>
        <p className="text-xs text-slate-400 mb-3">
          Opens the drawer attached to the receipt printer without recording a sale.
        </p>
        <button
          className="btn-ghost"
          onClick={async () => {
            try {
              const r = await window.pos.printers.openDrawer()
              toast(r.ok ? 'success' : 'error', r.ok ? 'Drawer pulse sent' : (r.error ?? 'Failed'))
            } catch (err) {
              toast('error', err instanceof Error ? err.message : String(err))
            }
          }}
        >
          No-sale / open drawer
        </button>
      </div>

      {editing && (
        <PrinterModal
          printer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refreshPrinters}
        />
      )}
    </div>
  )
}

const BLANK: Omit<Printer, 'id'> = {
  name: '',
  transport: 'tcp',
  target: '',
  port: 9100,
  width: 42,
  stations: [],
  is_receipt: 0,
  cash_drawer: 0,
  copies: 1,
  active: 1
}

function PrinterModal({
  printer,
  onClose,
  onSaved
}: {
  printer: Printer | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = usePos()
  const [form, setForm] = useState<Omit<Printer, 'id'>>(printer ?? BLANK)
  const [queues, setQueues] = useState<string[]>([])

  useEffect(() => {
    void window.pos.printers.queues().then(setQueues).catch(() => setQueues([]))
  }, [])

  const patch = (p: Partial<Omit<Printer, 'id'>>): void => setForm((f) => ({ ...f, ...p }))

  const toggleStation = (s: Station): void =>
    patch({
      stations: form.stations.includes(s)
        ? form.stations.filter((x) => x !== s)
        : [...form.stations, s]
    })

  const save = async (): Promise<void> => {
    try {
      if (!form.name.trim()) throw new Error('Give the printer a name')
      if (form.transport === 'tcp' && !form.target.trim()) {
        throw new Error('A network printer needs an IP address')
      }
      if (form.transport === 'cups' && !form.target.trim()) {
        throw new Error('Pick the OS print queue to send to')
      }

      printer
        ? await window.pos.printers.update(printer.id, form)
        : await window.pos.printers.create(form)

      await onSaved()
      toast('success', `${form.name} saved`)
      onClose()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open
      title={printer ? `Edit ${printer.name}` : 'Add a printer'}
      onClose={onClose}
      footer={
        <>
          {printer && (
            <button
              className="btn-danger mr-auto"
              onClick={async () => {
                await window.pos.printers.remove(printer.id)
                await onSaved()
                onClose()
              }}
            >
              Retire
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Name</label>
            <input
              className="field"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Kitchen Printer"
            />
          </div>
          <div>
            <label className="label">Paper width</label>
            <select
              className="field"
              value={form.width}
              onChange={(e) => patch({ width: Number(e.target.value) })}
            >
              <option value={32}>58mm — 32 columns</option>
              <option value={42}>80mm — 42 columns</option>
              <option value={48}>80mm — 48 columns</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Connection</label>
          <div className="grid grid-cols-3 gap-2">
            {(['tcp', 'cups', 'preview'] as PrinterTransport[]).map((t) => (
              <button
                key={t}
                onClick={() => patch({ transport: t })}
                className={cn(
                  'btn',
                  form.transport === t ? 'bg-brand-500 text-white' : 'bg-ink-600 text-slate-300'
                )}
              >
                {t === 'tcp' ? 'Network' : t === 'cups' ? 'USB / System' : 'Preview'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{TRANSPORT_HELP[form.transport]}</p>
        </div>

        {form.transport === 'tcp' && (
          <div className="grid grid-cols-[1fr_120px] gap-4">
            <div>
              <label className="label">IP address</label>
              <input
                className="field font-mono"
                value={form.target}
                onChange={(e) => patch({ target: e.target.value })}
                placeholder="192.168.1.50"
              />
            </div>
            <div>
              <label className="label">Port</label>
              <input
                className="field font-mono"
                value={form.port}
                onChange={(e) => patch({ port: Number(e.target.value) || 9100 })}
              />
            </div>
          </div>
        )}

        {form.transport === 'cups' && (
          <div>
            <label className="label">Print queue</label>
            {queues.length ? (
              <select
                className="field"
                value={form.target}
                onChange={(e) => patch({ target: e.target.value })}
              >
                <option value="">Select a queue…</option>
                {queues.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="field font-mono"
                value={form.target}
                onChange={(e) => patch({ target: e.target.value })}
                placeholder="EPSON_TM_T20III"
              />
            )}
          </div>
        )}

        <div>
          <label className="label">Stations routed to this printer</label>
          <div className="grid grid-cols-4 gap-2">
            {STATIONS.map((s) => (
              <button
                key={s}
                onClick={() => toggleStation(s)}
                className={cn(
                  'btn capitalize',
                  form.stations.includes(s)
                    ? 'bg-brand-500 text-white'
                    : 'bg-ink-600 text-slate-300'
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Two printers can share a station — both will print the ticket, which is how a busy
            kitchen keeps a spare at the pass.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Toggle
            label="Prints receipts"
            on={form.is_receipt === 1}
            onChange={(v) => patch({ is_receipt: v ? 1 : 0 })}
          />
          <Toggle
            label="Kicks cash drawer"
            on={form.cash_drawer === 1}
            onChange={(v) => patch({ cash_drawer: v ? 1 : 0 })}
          />
          <div>
            <label className="label">Copies</label>
            <input
              className="field"
              value={form.copies}
              onChange={(e) => patch({ copies: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Toggle({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <button
        onClick={() => onChange(!on)}
        className={cn(
          'btn w-full',
          on ? 'bg-emerald-600 text-white' : 'bg-ink-600 text-slate-400'
        )}
      >
        {on ? 'Yes' : 'No'}
      </button>
    </div>
  )
}

/* ---------- restaurant ---------- */

function RestaurantTab() {
  const { settings, saveSettings } = usePos()
  const [form, setForm] = useState(settings)

  useEffect(() => setForm(settings), [settings])
  if (!form) return null

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-slate-400">
        These details print at the top of every customer receipt.
      </p>

      <div className="panel px-5 py-5 space-y-4">
        <div>
          <label className="label">Restaurant name</label>
          <input
            className="field"
            value={form.restaurant_name}
            onChange={(e) => setForm({ ...form, restaurant_name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Address</label>
          <input
            className="field"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Phone</label>
            <input
              className="field"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Tax / VAT number</label>
            <input
              className="field"
              value={form.tax_id}
              onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label">Receipt footer</label>
          <input
            className="field"
            value={form.receipt_footer}
            onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })}
          />
        </div>
      </div>

      <div className="panel px-5 py-5 space-y-4">
        <div>
          <p className="text-sm font-semibold">How this venue trades</p>
          <p className="text-xs text-slate-400 mt-1 mb-3">
            A takeaway-only shop has no tables, so the floor plan is hidden entirely and the
            takeaway queue becomes the home screen. Dine-in only hides the takeaway and
            delivery screens.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['both', 'Dine in + takeaway'],
                ['dine_in', 'Dine in only'],
                ['takeaway', 'Takeaway only']
              ] as [ServiceMode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setForm({ ...form, service_mode: key })}
                className={cn(
                  'btn text-xs',
                  form.service_mode === key ? 'bg-brand-500 text-white' : 'bg-ink-600 text-slate-300'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Toggle
          label="Takeaway is paid when the order is sent"
          on={form.takeaway_pay_first === 1}
          onChange={(v) => setForm({ ...form, takeaway_pay_first: v ? 1 : 0 })}
        />
        <p className="text-[11px] text-slate-500">
          Turns the main button on takeaway and delivery orders into “send &amp; take payment”,
          so the order is rung in and settled in one pass. The payment sheet only opens if the kitchen tickets actually
          printed.
        </p>
      </div>

      <div className="panel px-5 py-5 space-y-4">
        <p className="text-sm font-semibold">Charges applied to new orders</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Currency symbol</label>
            <input
              className="field"
              value={form.currency_symbol}
              onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Tax %</label>
            <input
              className="field tabular-nums"
              value={form.tax_pct}
              onChange={(e) => setForm({ ...form, tax_pct: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label className="label">Service charge % (dine-in)</label>
            <input
              className="field tabular-nums"
              value={form.service_charge_pct}
              onChange={(e) => setForm({ ...form, service_charge_pct: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <Toggle
          label="Print the receipt automatically when a check is settled"
          on={form.auto_print_receipt === 1}
          onChange={(v) => setForm({ ...form, auto_print_receipt: v ? 1 : 0 })}
        />
        <p className="text-[11px] text-slate-500">
          Changing these affects orders opened from now on. Checks already open keep the rates they
          were opened with, so a bill never changes under the guest.
        </p>
      </div>

      <button className="btn-primary" onClick={() => saveSettings(form)}>
        Save settings
      </button>
    </div>
  )
}

/* ---------- print log ---------- */

function JobsTab() {
  const { toast, showPreview } = usePos()
  const [jobs, setJobs] = useState<PrintJob[]>([])

  const load = async (): Promise<void> => setJobs(await window.pos.print.jobs(80))
  useEffect(() => {
    void load()
  }, [])

  const failed = jobs.filter((j) => j.status === 'failed')

  const retry = async (id: number): Promise<void> => {
    const r = await window.pos.print.retry(id)
    toast(r.ok ? 'success' : 'error', r.ok ? 'Reprinted' : (r.error ?? 'Still failing'))
    await load()
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Every ticket the system has tried to print. A failed job can be re-sent byte-for-byte —
          nothing is lost because a printer was offline.
        </p>
        <div className="flex gap-2 shrink-0 ml-4">
          {failed.length > 0 && (
            <button
              className="btn-primary"
              onClick={async () => {
                const results = await window.pos.print.retryAll()
                const ok = results.filter((r) => r.ok).length
                toast(
                  ok === results.length ? 'success' : 'error',
                  `${ok} of ${results.length} jobs printed`
                )
                await load()
              }}
            >
              Retry {failed.length} failed
            </button>
          )}
          <button className="btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className="panel divide-y divide-ink-600">
        {jobs.length === 0 && (
          <p className="px-5 py-8 text-sm text-slate-500 text-center">Nothing printed yet.</p>
        )}
        {jobs.map((j) => (
          <div key={j.id} className="flex items-center gap-4 px-5 py-3">
            <span
              className={cn(
                'chip w-[70px] justify-center',
                j.status === 'done'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : j.status === 'failed'
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'bg-ink-600 text-slate-400'
              )}
            >
              {j.status}
            </span>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {j.kind} → {j.printer_name}
                {j.order_id && <span className="text-slate-500"> · order {j.order_id}</span>}
              </p>
              {j.error && <p className="text-[11px] text-rose-400 truncate">{j.error}</p>}
            </div>

            <span className="text-[11px] text-slate-500 shrink-0">{j.created_at.slice(11, 16)}</span>

            <button
              className="btn-ghost text-xs shrink-0"
              onClick={() =>
                showPreview([
                  {
                    printer_id: j.printer_id,
                    printer_name: j.printer_name,
                    kind: j.kind,
                    ok: j.status === 'done',
                    error: j.error ?? undefined,
                    preview: j.preview,
                    job_id: j.id
                  }
                ])
              }
            >
              View
            </button>
            <button className="btn-ghost text-xs shrink-0" onClick={() => retry(j.id)}>
              {j.status === 'failed' ? 'Retry' : 'Reprint'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
