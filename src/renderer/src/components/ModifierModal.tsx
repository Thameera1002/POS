import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { usePos } from '../store'
import { cn, money } from '../lib/format'
import type { MenuItemWithModifiers } from '../../../shared/types'

/**
 * Item detail sheet: quantity, required/optional modifier groups, and the free
 * text note that ends up in bold on the kitchen ticket.
 *
 * Required groups (`min_select > 0`) block the Add button, because "steak, no
 * doneness specified" is a ticket the kitchen has to come and ask about.
 */
export function ModifierModal({
  item,
  onClose
}: {
  item: MenuItemWithModifiers | null
  onClose: () => void
}) {
  const { addItem, settings } = usePos()
  const [qty, setQty] = useState(1)
  const [chosen, setChosen] = useState<Record<number, number[]>>({})
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!item) return
    setQty(1)
    setNotes('')
    // Pre-select the first option of any single-choice required group: it is the
    // common case, and it saves a tap per item during a rush.
    const initial: Record<number, number[]> = {}
    for (const g of item.modifier_groups) {
      if (g.min_select > 0 && g.max_select === 1 && g.modifiers[0]) {
        initial[g.id] = [g.modifiers[0].id]
      }
    }
    setChosen(initial)
  }, [item])

  if (!item) return null

  const sym = settings?.currency_symbol ?? ''

  const toggle = (groupId: number, modId: number, maxSelect: number): void => {
    setChosen((prev) => {
      const current = prev[groupId] ?? []
      if (current.includes(modId)) return { ...prev, [groupId]: current.filter((x) => x !== modId) }
      if (maxSelect === 1) return { ...prev, [groupId]: [modId] }
      if (current.length >= maxSelect) return prev
      return { ...prev, [groupId]: [...current, modId] }
    })
  }

  const unmet = item.modifier_groups.filter(
    (g) => (chosen[g.id]?.length ?? 0) < g.min_select
  )

  const modifierTotal = item.modifier_groups.reduce((sum, g) => {
    const ids = chosen[g.id] ?? []
    return sum + g.modifiers.filter((m) => ids.includes(m.id)).reduce((n, m) => n + m.price_cents, 0)
  }, 0)

  const lineTotal = (item.price_cents + modifierTotal) * qty

  const submit = async (): Promise<void> => {
    await addItem({
      menu_item_id: item.id,
      qty,
      notes: notes.trim() || null,
      modifier_ids: Object.values(chosen).flat()
    })
    onClose()
  }

  return (
    <Modal
      open
      title={item.name}
      subtitle={`${money(item.price_cents, sym)} · goes to ${item.station}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary min-w-[180px]" onClick={submit} disabled={unmet.length > 0}>
            {unmet.length > 0 ? `Choose ${unmet[0].name}` : `Add · ${money(lineTotal, sym)}`}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <div>
          <label className="label">Quantity</label>
          <div className="flex items-center gap-3">
            <button
              className="btn-ghost w-14 text-xl"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <span className="w-16 text-center text-2xl font-bold tabular-nums">{qty}</span>
            <button className="btn-ghost w-14 text-xl" onClick={() => setQty((q) => q + 1)}>
              +
            </button>
            <div className="flex gap-2 ml-2">
              {[2, 3, 4, 6].map((n) => (
                <button key={n} className="btn-ghost px-3 text-xs" onClick={() => setQty(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {item.modifier_groups.map((group) => {
          const ids = chosen[group.id] ?? []
          const required = group.min_select > 0
          return (
            <div key={group.id}>
              <label className="label flex items-center gap-2">
                {group.name}
                {required ? (
                  <span className="chip bg-rose-500/20 text-rose-300">required</span>
                ) : (
                  <span className="chip bg-ink-600 text-slate-400">
                    up to {group.max_select}
                  </span>
                )}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {group.modifiers.map((mod) => {
                  const on = ids.includes(mod.id)
                  return (
                    <button
                      key={mod.id}
                      onClick={() => toggle(group.id, mod.id, group.max_select)}
                      className={cn(
                        'rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                        on
                          ? 'border-brand-500 bg-brand-500/15 text-white'
                          : 'border-ink-500 bg-ink-700 text-slate-300 hover:border-ink-400'
                      )}
                    >
                      <span className="block font-medium">{mod.name}</span>
                      {mod.price_cents > 0 && (
                        <span className="text-[11px] text-slate-400">
                          +{money(mod.price_cents, sym)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div>
          <label className="label">Note for the kitchen</label>
          <textarea
            className="field resize-none"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. no peanuts — allergy"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            Notes print in bold double-height on the kitchen ticket.
          </p>
        </div>
      </div>
    </Modal>
  )
}
