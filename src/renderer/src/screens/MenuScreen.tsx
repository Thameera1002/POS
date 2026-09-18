import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePos } from '../store'
import { Modal } from '../components/Modal'
import { cn, money, toCents } from '../lib/format'
import {
  STATIONS,
  type Category,
  type MenuItemInput,
  type MenuItemWithModifiers,
  type Modifier,
  type ModifierGroup,
  type Station
} from '../../../shared/types'

type Group = ModifierGroup & { modifiers: Modifier[] }

const STATION_DOT: Record<Station, string> = {
  kitchen: 'bg-orange-400',
  grill: 'bg-red-400',
  bar: 'bg-violet-400',
  dessert: 'bg-pink-400',
  none: 'bg-slate-500'
}

const SWATCHES = ['#f59e0b', '#ef4444', '#84cc16', '#ec4899', '#06b6d4', '#8b5cf6', '#64748b']

/**
 * Menu management.
 *
 * Prices move and dishes come and go, so this has to be usable by the owner
 * without a developer. Two safety properties hold throughout:
 *
 *  - Editing a price never restates an existing bill. `order_items` snapshots
 *    the name and unit price when the line is rung in, so open checks and past
 *    takings are unaffected by anything done here.
 *  - Nothing is ever hard-deleted. Removing an item hides it, which keeps the
 *    history of what was sold intact and lets a seasonal dish come back.
 */
export function MenuScreen() {
  const { toast, refreshMenu } = usePos()

  const [items, setItems] = useState<MenuItemWithModifiers[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [groups, setGroups] = useState<Group[]>([])

  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)

  const [editing, setEditing] = useState<MenuItemWithModifiers | 'new' | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [i, c, g] = await Promise.all([
        window.pos.menu.allItems(),
        window.pos.menu.allCategories(),
        window.pos.menu.modifierGroups()
      ])
      setItems(i)
      setCategories(c)
      setGroups(g)
      // The order screen holds its own copy of the sellable menu; keep it honest.
      await refreshMenu()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }, [toast, refreshMenu])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (!showHidden && !i.active) return false
      if (q) return i.name.toLowerCase().includes(q)
      return categoryId === null || i.category_id === categoryId
    })
  }, [items, categoryId, search, showHidden])

  const hiddenCount = items.filter((i) => !i.active).length

  const act = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    try {
      await fn()
      await load()
      toast('success', message)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 pt-6 pb-4">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold">Menu</h1>
            <p className="text-sm text-slate-400 mt-1">
              {items.filter((i) => i.active).length} items on sale
              {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setEditingCategory('new')}>
              + Category
            </button>
            <button className="btn-primary" onClick={() => setEditing('new')}>
              + Item
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            className="field flex-1"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className={cn('btn', showHidden ? 'bg-brand-500 text-white' : 'bg-ink-600 text-slate-300')}
            onClick={() => setShowHidden((v) => !v)}
          >
            Show hidden
          </button>
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          <button
            onClick={() => {
              setCategoryId(null)
              setSearch('')
            }}
            className={cn(
              'btn whitespace-nowrap',
              categoryId === null && !search ? 'bg-brand-500 text-white' : 'bg-ink-600 text-slate-300'
            )}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCategoryId(c.id)
                setSearch('')
              }}
              onDoubleClick={() => setEditingCategory(c)}
              title="Double-click to rename"
              className={cn(
                'btn whitespace-nowrap',
                !c.active && 'opacity-40',
                categoryId === c.id ? 'text-white' : 'bg-ink-600 text-slate-300'
              )}
              style={categoryId === c.id ? { backgroundColor: c.color } : undefined}
            >
              {c.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-6">
        <div className="panel divide-y divide-ink-600">
          {visible.length === 0 && (
            <p className="px-5 py-10 text-sm text-slate-500 text-center">
              Nothing here yet. Add an item to get started.
            </p>
          )}

          {visible.map((item) => {
            const cat = categories.find((c) => c.id === item.category_id)
            return (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-4 px-5 py-3 hover:bg-ink-700/40',
                  !item.active && 'opacity-45'
                )}
              >
                <span
                  className={cn('h-2.5 w-2.5 rounded-full shrink-0', STATION_DOT[item.station])}
                  title={`${item.station} station`}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{item.name}</span>
                    {!item.active && <span className="chip bg-ink-600 text-slate-500">hidden</span>}
                    {!item.taxable && (
                      <span className="chip bg-ink-600 text-slate-400">no tax</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {cat?.name ?? '—'} · {item.station}
                    {item.kitchen_name && ` · prints as "${item.kitchen_name}"`}
                    {item.modifier_groups.length > 0 &&
                      ` · ${item.modifier_groups.map((g) => g.name).join(', ')}`}
                  </p>
                </div>

                <span className="font-bold tabular-nums text-brand-400 w-[92px] text-right shrink-0">
                  {money(item.price_cents)}
                </span>

                <div className="flex gap-2 shrink-0">
                  {/* "86 it" — sold out for the rest of service, one tap, no dialog. */}
                  <button
                    className="btn-ghost text-xs w-[74px]"
                    onClick={() =>
                      act(
                        () => window.pos.menu.setAvailable(item.id, !item.active),
                        item.active ? `${item.name} hidden` : `${item.name} back on sale`
                      )
                    }
                  >
                    {item.active ? '86 it' : 'Restore'}
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => setEditing(item)}>
                    Edit
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {editing && (
        <ItemModal
          item={editing === 'new' ? null : editing}
          categories={categories.filter((c) => c.active)}
          groups={groups}
          defaultCategoryId={categoryId}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {editingCategory && (
        <CategoryModal
          category={editingCategory === 'new' ? null : editingCategory}
          onClose={() => setEditingCategory(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

const BLANK: MenuItemInput = {
  category_id: 0,
  name: '',
  kitchen_name: null,
  price_cents: 0,
  station: 'kitchen',
  taxable: 1,
  active: 1,
  sort_order: 0,
  modifier_group_ids: []
}

function ItemModal({
  item,
  categories,
  groups,
  defaultCategoryId,
  onClose,
  onSaved
}: {
  item: MenuItemWithModifiers | null
  categories: Category[]
  groups: Group[]
  defaultCategoryId: number | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = usePos()

  const [form, setForm] = useState<MenuItemInput>(
    item
      ? {
          category_id: item.category_id,
          name: item.name,
          kitchen_name: item.kitchen_name,
          price_cents: item.price_cents,
          station: item.station,
          taxable: item.taxable,
          active: item.active,
          sort_order: item.sort_order,
          modifier_group_ids: item.modifier_groups.map((g) => g.id)
        }
      : { ...BLANK, category_id: defaultCategoryId ?? categories[0]?.id ?? 0 }
  )
  // Price is edited as text so a half-typed "12." does not snap to 12.00.
  const [price, setPrice] = useState((item ? item.price_cents / 100 : 0).toFixed(2))

  const patch = (p: Partial<MenuItemInput>): void => setForm((f) => ({ ...f, ...p }))

  const toggleGroup = (id: number): void =>
    patch({
      modifier_group_ids: form.modifier_group_ids?.includes(id)
        ? form.modifier_group_ids.filter((x) => x !== id)
        : [...(form.modifier_group_ids ?? []), id]
    })

  const save = async (): Promise<void> => {
    try {
      const payload = { ...form, price_cents: toCents(price) }
      item
        ? await window.pos.menu.updateItem(item.id, payload)
        : await window.pos.menu.createItem(payload)
      await onSaved()
      toast('success', `${payload.name} saved`)
      onClose()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open
      title={item ? `Edit ${item.name}` : 'New menu item'}
      subtitle={
        item
          ? 'Price changes apply to new orders only — open checks and past sales are untouched.'
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          {item && (
            <button
              className="btn-danger mr-auto"
              onClick={async () => {
                await window.pos.menu.archiveItem(item.id)
                await onSaved()
                onClose()
              }}
            >
              Remove from menu
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
        <div className="grid grid-cols-[1fr_140px] gap-4">
          <div>
            <label className="label">Name</label>
            <input
              className="field"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Butter Chicken"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Price</label>
            <input
              className="field tabular-nums text-lg"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Category</label>
            <select
              className="field"
              value={form.category_id}
              onChange={(e) => patch({ category_id: Number(e.target.value) })}
            >
              {categories.length === 0 && <option value={0}>Create a category first</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Station</label>
            <select
              className="field capitalize"
              value={form.station}
              onChange={(e) => patch({ station: e.target.value as Station })}
            >
              {STATIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Decides which printer cooks this.
            </p>
          </div>
        </div>

        <div>
          <label className="label">Kitchen name (optional)</label>
          <input
            className="field font-mono"
            value={form.kitchen_name ?? ''}
            onChange={(e) => patch({ kitchen_name: e.target.value || null })}
            placeholder={form.name ? form.name.toUpperCase().slice(0, 16) : 'SHORT NAME'}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            Kitchen tickets are 32–48 characters wide and printed double-width. A long dish name
            wraps badly — give it a short name here and the ticket uses that instead.
          </p>
        </div>

        {groups.length > 0 && (
          <div>
            <label className="label">Modifier groups</label>
            <div className="grid grid-cols-2 gap-2">
              {groups.map((g) => {
                const on = form.modifier_group_ids?.includes(g.id)
                return (
                  <button
                    key={g.id}
                    onClick={() => toggleGroup(g.id)}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                      on
                        ? 'border-brand-500 bg-brand-500/15 text-white'
                        : 'border-ink-500 bg-ink-700 text-slate-300 hover:border-ink-400'
                    )}
                  >
                    <span className="block font-medium">{g.name}</span>
                    <span className="text-[11px] text-slate-400">
                      {g.min_select > 0 ? 'required · ' : ''}
                      {g.modifiers.map((m) => m.name).join(', ')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Toggle
            label="Taxable"
            on={form.taxable === 1}
            onChange={(v) => patch({ taxable: v ? 1 : 0 })}
          />
          <Toggle
            label="On sale"
            on={form.active === 1}
            onChange={(v) => patch({ active: v ? 1 : 0 })}
          />
        </div>
      </div>
    </Modal>
  )
}

function CategoryModal({
  category,
  onClose,
  onSaved
}: {
  category: Category | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = usePos()
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? SWATCHES[0])

  const save = async (): Promise<void> => {
    try {
      category
        ? await window.pos.menu.updateCategory(category.id, { name, color })
        : await window.pos.menu.createCategory(name, color)
      await onSaved()
      toast('success', `${name} saved`)
      onClose()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open
      title={category ? `Edit ${category.name}` : 'New category'}
      onClose={onClose}
      width="sm"
      footer={
        <>
          {category && (
            <button
              className="btn-danger mr-auto"
              onClick={async () => {
                await window.pos.menu.archiveCategory(category.id)
                await onSaved()
                onClose()
              }}
            >
              Remove
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">Colour</label>
          <div className="flex gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={cn(
                  'h-10 w-10 rounded-xl border-2 transition-transform',
                  color === c ? 'border-white scale-110' : 'border-transparent'
                )}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        {category && (
          <p className="text-[11px] text-slate-500">
            Removing a category also hides every item in it. Nothing is deleted — past orders keep
            their records.
          </p>
        )}
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
        className={cn('btn w-full', on ? 'bg-emerald-600 text-white' : 'bg-ink-600 text-slate-400')}
      >
        {on ? 'Yes' : 'No'}
      </button>
    </div>
  )
}
