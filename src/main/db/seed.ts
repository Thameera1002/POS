import type Database from 'better-sqlite3'
import type { Station } from '../../shared/types'

/**
 * Seeds a demo restaurant the first time the app runs. Guarded on an empty
 * `categories` table, so it never overwrites a live menu.
 */
export function seed(db: Database.Database): void {
  seedSettings(db)
  seedPrinters(db)

  const hasMenu = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }
  if (hasMenu.n > 0) return

  db.transaction(() => {
    seedTables(db)
    seedMenu(db)
  })()

  console.log('[db] seeded demo restaurant')
}

const DEFAULT_SETTINGS: Record<string, string> = {
  restaurant_name: 'Saffron Kitchen',
  address: '18 Marine Drive, Colombo 03',
  phone: '+94 11 234 5678',
  tax_id: 'VAT 1094-5521',
  currency_symbol: 'Rs.',
  // 'both' is the safe default: a venue that only does takeaway switches to
  // 'takeaway' in Settings and the floor plan disappears entirely.
  service_mode: 'both',
  takeaway_pay_first: '1',
  tax_pct: '8',
  service_charge_pct: '10',
  receipt_footer: 'Thank you for dining with us!',
  auto_print_receipt: '1'
}

function seedSettings(db: Database.Database): void {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v)
}

function seedPrinters(db: Database.Database): void {
  const has = db.prepare('SELECT COUNT(*) AS n FROM printers').get() as { n: number }
  if (has.n > 0) return

  const ins = db.prepare(`
    INSERT INTO printers (name, transport, target, port, width, stations, is_receipt, cash_drawer, copies)
    VALUES (@name, @transport, @target, @port, @width, @stations, @is_receipt, @cash_drawer, @copies)
  `)

  // Preview transport out of the box: the whole print pipeline is exercisable
  // with no hardware. Switch these to `tcp` + an IP in Settings on install day.
  ins.run({
    name: 'Kitchen Printer',
    transport: 'preview',
    target: '192.168.1.50',
    port: 9100,
    width: 42,
    stations: JSON.stringify(['kitchen', 'grill']),
    is_receipt: 0,
    cash_drawer: 0,
    copies: 1
  })
  ins.run({
    name: 'Bar Printer',
    transport: 'preview',
    target: '192.168.1.51',
    port: 9100,
    width: 42,
    stations: JSON.stringify(['bar', 'dessert']),
    is_receipt: 0,
    cash_drawer: 0,
    copies: 1
  })
  ins.run({
    name: 'Front Counter',
    transport: 'preview',
    target: '192.168.1.52',
    port: 9100,
    width: 48,
    stations: JSON.stringify([]),
    is_receipt: 1,
    cash_drawer: 1,
    copies: 1
  })
}

function seedTables(db: Database.Database): void {
  const ins = db.prepare('INSERT INTO tables (name, seats, zone) VALUES (?, ?, ?)')
  for (let i = 1; i <= 8; i++) ins.run(`T${i}`, i <= 4 ? 2 : 4, 'Main Hall')
  for (let i = 1; i <= 4; i++) ins.run(`P${i}`, 6, 'Terrace')
  for (let i = 1; i <= 3; i++) ins.run(`B${i}`, 2, 'Bar')
}

interface SeedItem {
  name: string
  price: number
  station: Station
  kitchen?: string
  mods?: string[]
}

const MENU: { category: string; color: string; items: SeedItem[] }[] = [
  {
    category: 'Starters',
    color: '#f59e0b',
    items: [
      { name: 'Garlic Bread', price: 550, station: 'kitchen' },
      { name: 'Devilled Cashews', price: 890, station: 'kitchen' },
      { name: 'Chicken Wings (6 pc)', price: 1250, station: 'grill', mods: ['Spice Level'] },
      { name: 'Prawn Tempura', price: 1650, station: 'kitchen' },
      { name: 'Soup of the Day', price: 700, station: 'kitchen' }
    ]
  },
  {
    category: 'Mains',
    color: '#ef4444',
    items: [
      {
        name: 'Grilled Seer Fish',
        price: 2950,
        station: 'grill',
        kitchen: 'GRILL SEER',
        mods: ['Cooking', 'Side Choice']
      },
      {
        name: 'Ribeye Steak 300g',
        price: 5400,
        station: 'grill',
        kitchen: 'RIBEYE 300',
        mods: ['Cooking', 'Side Choice']
      },
      { name: 'Butter Chicken', price: 2250, station: 'kitchen', mods: ['Spice Level'] },
      { name: 'Nasi Goreng', price: 1850, station: 'kitchen', mods: ['Spice Level'] },
      { name: 'Margherita Pizza', price: 1950, station: 'kitchen', mods: ['Pizza Extras'] },
      { name: 'Vegetable Kottu', price: 1450, station: 'kitchen', mods: ['Spice Level'] }
    ]
  },
  {
    category: 'Sides',
    color: '#84cc16',
    items: [
      { name: 'French Fries', price: 600, station: 'kitchen' },
      { name: 'Garden Salad', price: 750, station: 'kitchen' },
      { name: 'Steamed Rice', price: 400, station: 'kitchen' },
      { name: 'Sauteed Greens', price: 680, station: 'kitchen' }
    ]
  },
  {
    category: 'Desserts',
    color: '#ec4899',
    items: [
      { name: 'Chocolate Fondant', price: 1150, station: 'dessert' },
      { name: 'Watalappan', price: 850, station: 'dessert' },
      { name: 'Ice Cream (2 scoops)', price: 700, station: 'dessert' }
    ]
  },
  {
    category: 'Drinks',
    color: '#06b6d4',
    items: [
      { name: 'Still Water 1L', price: 300, station: 'bar' },
      { name: 'Fresh Lime Soda', price: 550, station: 'bar', mods: ['Sweetness'] },
      { name: 'Iced Coffee', price: 750, station: 'bar' },
      { name: 'King Coconut', price: 450, station: 'bar' },
      { name: 'Ceylon Tea', price: 350, station: 'bar' }
    ]
  },
  {
    category: 'Bar',
    color: '#8b5cf6',
    items: [
      { name: 'Draft Beer Pint', price: 1100, station: 'bar' },
      { name: 'House Red (glass)', price: 1450, station: 'bar' },
      { name: 'Mojito', price: 1650, station: 'bar' },
      { name: 'Old Fashioned', price: 1950, station: 'bar' }
    ]
  }
]

const MODIFIER_GROUPS: { name: string; min: number; max: number; mods: [string, number][] }[] = [
  {
    name: 'Spice Level',
    min: 1,
    max: 1,
    mods: [
      ['Mild', 0],
      ['Medium', 0],
      ['Hot', 0],
      ['Extra Hot', 0]
    ]
  },
  {
    name: 'Cooking',
    min: 1,
    max: 1,
    mods: [
      ['Rare', 0],
      ['Medium Rare', 0],
      ['Medium', 0],
      ['Well Done', 0]
    ]
  },
  {
    name: 'Side Choice',
    min: 1,
    max: 1,
    mods: [
      ['Fries', 0],
      ['Mashed Potato', 0],
      ['Steamed Rice', 0],
      ['Salad', 100]
    ]
  },
  {
    name: 'Pizza Extras',
    min: 0,
    max: 4,
    mods: [
      ['Extra Cheese', 350],
      ['Mushroom', 250],
      ['Pepperoni', 450],
      ['Jalapeno', 200]
    ]
  },
  {
    name: 'Sweetness',
    min: 1,
    max: 1,
    mods: [
      ['No Sugar', 0],
      ['Less Sugar', 0],
      ['Normal', 0]
    ]
  }
]

function seedMenu(db: Database.Database): void {
  const insGroup = db.prepare(
    'INSERT INTO modifier_groups (name, min_select, max_select) VALUES (?, ?, ?)'
  )
  const insMod = db.prepare('INSERT INTO modifiers (group_id, name, price_cents) VALUES (?, ?, ?)')
  const groupIds = new Map<string, number>()

  for (const g of MODIFIER_GROUPS) {
    const gid = Number(insGroup.run(g.name, g.min, g.max).lastInsertRowid)
    groupIds.set(g.name, gid)
    for (const [name, price] of g.mods) insMod.run(gid, name, price)
  }

  const insCat = db.prepare(
    'INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)'
  )
  const insItem = db.prepare(`
    INSERT INTO menu_items (category_id, name, kitchen_name, price_cents, station, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insLink = db.prepare(
    'INSERT INTO menu_item_modifier_groups (menu_item_id, group_id, sort_order) VALUES (?, ?, ?)'
  )

  MENU.forEach((cat, ci) => {
    const cid = Number(insCat.run(cat.category, cat.color, ci).lastInsertRowid)
    cat.items.forEach((item, ii) => {
      const iid = Number(
        insItem.run(cid, item.name, item.kitchen ?? null, item.price, item.station, ii)
          .lastInsertRowid
      )
      item.mods?.forEach((groupName, gi) => {
        const gid = groupIds.get(groupName)
        if (gid) insLink.run(iid, gid, gi)
      })
    })
  })
}
