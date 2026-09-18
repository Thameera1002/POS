import { getDb } from '../db'
import type {
  Category,
  DiningTable,
  MenuItem,
  MenuItemInput,
  MenuItemWithModifiers,
  Modifier,
  ModifierGroup
} from '../../shared/types'

export function listCategories(): Category[] {
  return getDb()
    .prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, name')
    .all() as Category[]
}

/** Includes retired categories — the menu manager has to show them to restore one. */
export function listAllCategories(): Category[] {
  return getDb().prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as Category[]
}

/**
 * The whole menu with modifier groups attached, fetched in three queries rather
 * than N+1. Small enough to load once at startup and keep in renderer state.
 *
 * @param includeInactive the order screen wants only what is sellable right now;
 *        the menu manager wants everything, including items that are 86'd.
 */
export function listMenu(includeInactive = false): MenuItemWithModifiers[] {
  const db = getDb()

  const items = db
    .prepare(
      `SELECT * FROM menu_items ${includeInactive ? '' : 'WHERE active = 1'}
       ORDER BY sort_order, name`
    )
    .all() as MenuItem[]

  const links = db
    .prepare(
      `SELECT l.menu_item_id, g.id, g.name, g.min_select, g.max_select, l.sort_order
       FROM menu_item_modifier_groups l JOIN modifier_groups g ON g.id = l.group_id
       ORDER BY l.sort_order`
    )
    .all() as (ModifierGroup & { menu_item_id: number; sort_order: number })[]

  const mods = db.prepare('SELECT * FROM modifiers ORDER BY id').all() as Modifier[]

  const modsByGroup = new Map<number, Modifier[]>()
  for (const m of mods) {
    const bucket = modsByGroup.get(m.group_id)
    bucket ? bucket.push(m) : modsByGroup.set(m.group_id, [m])
  }

  const groupsByItem = new Map<number, MenuItemWithModifiers['modifier_groups']>()
  for (const l of links) {
    const group = {
      id: l.id,
      name: l.name,
      min_select: l.min_select,
      max_select: l.max_select,
      modifiers: modsByGroup.get(l.id) ?? []
    }
    const bucket = groupsByItem.get(l.menu_item_id)
    bucket ? bucket.push(group) : groupsByItem.set(l.menu_item_id, [group])
  }

  return items.map((item) => ({ ...item, modifier_groups: groupsByItem.get(item.id) ?? [] }))
}

export function listTables(): DiningTable[] {
  return getDb()
    .prepare('SELECT * FROM tables WHERE active = 1 ORDER BY zone, name')
    .all() as DiningTable[]
}

export function listModifierGroups(): (ModifierGroup & { modifiers: Modifier[] })[] {
  const db = getDb()
  const groups = db.prepare('SELECT * FROM modifier_groups ORDER BY name').all() as ModifierGroup[]
  const mods = db.prepare('SELECT * FROM modifiers ORDER BY id').all() as Modifier[]
  return groups.map((g) => ({ ...g, modifiers: mods.filter((m) => m.group_id === g.id) }))
}

function validate(input: Pick<MenuItemInput, 'name' | 'price_cents' | 'category_id'>): void {
  if (!input.name.trim()) throw new Error('The item needs a name')
  if (!Number.isInteger(input.price_cents) || input.price_cents < 0) {
    throw new Error('Price must be zero or more')
  }
  const cat = getDb()
    .prepare('SELECT id FROM categories WHERE id = ?')
    .get(input.category_id) as { id: number } | undefined
  if (!cat) throw new Error('Pick a category for this item')
}

/** Replaces an item's modifier-group links wholesale. */
function setModifierGroups(itemId: number, groupIds: number[]): void {
  const db = getDb()
  db.prepare('DELETE FROM menu_item_modifier_groups WHERE menu_item_id = ?').run(itemId)
  const ins = db.prepare(
    'INSERT OR IGNORE INTO menu_item_modifier_groups (menu_item_id, group_id, sort_order) VALUES (?, ?, ?)'
  )
  groupIds.forEach((gid, i) => ins.run(itemId, gid, i))
}

export function createMenuItem(input: MenuItemInput): MenuItem {
  const db = getDb()
  validate(input)

  return db.transaction(() => {
    // New items land at the end of their category rather than the top, so adding
    // one does not reshuffle a menu the staff have learned the shape of.
    const max = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM menu_items WHERE category_id = ?')
      .get(input.category_id) as { m: number }

    const id = Number(
      db
        .prepare(
          `INSERT INTO menu_items (category_id, name, kitchen_name, price_cents, station, taxable, active, sort_order)
           VALUES (@category_id, @name, @kitchen_name, @price_cents, @station, @taxable, @active, @sort_order)`
        )
        .run({
          category_id: input.category_id,
          name: input.name.trim(),
          kitchen_name: input.kitchen_name?.trim() || null,
          price_cents: input.price_cents,
          station: input.station,
          taxable: input.taxable,
          active: input.active,
          sort_order: input.sort_order || max.m + 1
        }).lastInsertRowid
    )

    setModifierGroups(id, input.modifier_group_ids ?? [])
    return db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as MenuItem
  })()
}

/**
 * Edits an item in place.
 *
 * Changing a price here deliberately does NOT touch orders already on the books:
 * `order_items` snapshots the name and unit price at the moment the line was
 * rung in, so a mid-service price change can never restate a guest's open bill
 * or rewrite yesterday's takings.
 */
export function updateMenuItem(id: number, patch: Partial<MenuItemInput>): MenuItem {
  const db = getDb()
  const current = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as
    | MenuItem
    | undefined
  if (!current) throw new Error(`Menu item ${id} not found`)

  const next = { ...current, ...patch }
  validate(next)

  return db.transaction(() => {
    db.prepare(
      `UPDATE menu_items SET category_id=@category_id, name=@name, kitchen_name=@kitchen_name,
       price_cents=@price_cents, station=@station, taxable=@taxable, active=@active,
       sort_order=@sort_order WHERE id=@id`
    ).run({
      category_id: next.category_id,
      name: next.name.trim(),
      kitchen_name: next.kitchen_name?.trim() || null,
      price_cents: next.price_cents,
      station: next.station,
      taxable: next.taxable,
      active: next.active,
      sort_order: next.sort_order,
      id
    })

    if (patch.modifier_group_ids !== undefined) {
      setModifierGroups(id, patch.modifier_group_ids)
    }
    return db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as MenuItem
  })()
}

/**
 * Hidden rather than deleted, so historical orders keep their item reference and
 * the item can be brought back when it is on the menu again.
 */
export function archiveMenuItem(id: number): void {
  getDb().prepare('UPDATE menu_items SET active = 0 WHERE id = ?').run(id)
}

export function restoreMenuItem(id: number): void {
  getDb().prepare('UPDATE menu_items SET active = 1 WHERE id = ?').run(id)
}

/** Sells out an item for the rest of service ("86 it") without editing it. */
export function setMenuItemAvailable(id: number, available: boolean): MenuItem {
  const db = getDb()
  db.prepare('UPDATE menu_items SET active = ? WHERE id = ?').run(available ? 1 : 0, id)
  const row = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as MenuItem | undefined
  if (!row) throw new Error(`Menu item ${id} not found`)
  return row
}

export function createCategory(name: string, color: string): Category {
  const db = getDb()
  if (!name.trim()) throw new Error('The category needs a name')

  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories').get() as {
    m: number
  }
  const id = Number(
    db
      .prepare('INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)')
      .run(name.trim(), color, max.m + 1).lastInsertRowid
  )
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category
}

export function updateCategory(
  id: number,
  patch: Partial<Pick<Category, 'name' | 'color' | 'sort_order' | 'active'>>
): Category {
  const db = getDb()
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
    | Category
    | undefined
  if (!current) throw new Error(`Category ${id} not found`)

  const next = { ...current, ...patch }
  if (!next.name.trim()) throw new Error('The category needs a name')

  db.prepare(
    'UPDATE categories SET name=@name, color=@color, sort_order=@sort_order, active=@active WHERE id=@id'
  ).run({ ...next, name: next.name.trim(), id })

  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category
}

/** Retires a category and everything in it, so no orphan items stay sellable. */
export function archiveCategory(id: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(id)
    db.prepare('UPDATE menu_items SET active = 0 WHERE category_id = ?').run(id)
  })()
}

export function createTable(name: string, seats: number, zone: string): DiningTable {
  const db = getDb()
  const id = Number(
    db.prepare('INSERT INTO tables (name, seats, zone) VALUES (?, ?, ?)').run(name, seats, zone)
      .lastInsertRowid
  )
  return db.prepare('SELECT * FROM tables WHERE id = ?').get(id) as DiningTable
}

export function archiveTable(id: number): void {
  getDb().prepare('UPDATE tables SET active = 0 WHERE id = ?').run(id)
}
