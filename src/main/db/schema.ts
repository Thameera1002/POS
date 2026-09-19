/**
 * Schema is applied as a list of numbered migrations so an installed terminal
 * can be upgraded in place without losing a day's sales.
 */

export interface Migration {
  version: number
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#64748b',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE menu_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  name         TEXT NOT NULL,
  kitchen_name TEXT,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  station      TEXT NOT NULL DEFAULT 'kitchen',
  taxable      INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);

CREATE TABLE modifier_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  min_select  INTEGER NOT NULL DEFAULT 0,
  max_select  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE modifiers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_modifiers_group ON modifiers(group_id);

CREATE TABLE menu_item_modifier_groups (
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id     INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, group_id)
);

CREATE TABLE tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  seats  INTEGER NOT NULL DEFAULT 2,
  zone   TEXT NOT NULL DEFAULT 'Main',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number       INTEGER NOT NULL,
  order_type         TEXT NOT NULL DEFAULT 'dine_in',
  table_id           INTEGER REFERENCES tables(id),
  guest_count        INTEGER NOT NULL DEFAULT 1,
  customer_name      TEXT,
  customer_phone     TEXT,
  status             TEXT NOT NULL DEFAULT 'open',
  discount_pct       REAL NOT NULL DEFAULT 0,
  service_charge_pct REAL NOT NULL DEFAULT 0,
  tax_pct            REAL NOT NULL DEFAULT 0,
  note               TEXT,
  round              INTEGER NOT NULL DEFAULT 0,
  opened_at          TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at          TEXT
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_opened ON orders(opened_at);

CREATE TABLE order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id     INTEGER REFERENCES menu_items(id),
  name             TEXT NOT NULL,
  kitchen_name     TEXT,
  station          TEXT NOT NULL DEFAULT 'kitchen',
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL DEFAULT 0,
  taxable          INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  fired_round      INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_item_modifiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id   INTEGER REFERENCES modifiers(id),
  name          TEXT NOT NULL,
  price_cents   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_oim_item ON order_item_modifiers(order_item_id);

CREATE TABLE payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method         TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL,
  tendered_cents INTEGER,
  reference      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE printers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  transport   TEXT NOT NULL DEFAULT 'preview',
  target      TEXT NOT NULL DEFAULT '',
  port        INTEGER NOT NULL DEFAULT 9100,
  width       INTEGER NOT NULL DEFAULT 42,
  stations    TEXT NOT NULL DEFAULT '[]',
  is_receipt  INTEGER NOT NULL DEFAULT 0,
  cash_drawer INTEGER NOT NULL DEFAULT 0,
  copies      INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE print_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_id INTEGER NOT NULL REFERENCES printers(id),
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  preview    TEXT NOT NULL DEFAULT '',
  payload    BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_print_jobs_status ON print_jobs(status);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Daily order numbering. One row per business day; reset happens naturally
-- because a new day inserts a new row starting at 0.
CREATE TABLE order_counters (
  day  TEXT PRIMARY KEY,
  last INTEGER NOT NULL DEFAULT 0
);
`
  },
  {
    version: 2,
    // Delivery address gets its own column. It was riding on `note`, which is
    // fine for "ring the bell twice" but not for a field the app now requires
    // and needs to validate, search and print in a fixed position.
    sql: `
ALTER TABLE orders ADD COLUMN delivery_address TEXT;
`
  }
]
