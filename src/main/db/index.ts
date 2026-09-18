import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { MIGRATIONS } from './schema'
import { seed } from './seed'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database accessed before initDb()')
  return db
}

export function initDb(): Database.Database {
  // POS_DB_PATH lets the smoke test (and a support engineer opening a copy of a
  // customer's database) run against a file other than the live till's.
  const file = process.env.POS_DB_PATH || join(app.getPath('userData'), 'pos.db')
  db = new Database(file)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Orders are written one at a time from a single process; NORMAL is the right
  // durability/throughput trade for a terminal on a UPS-backed till.
  db.pragma('synchronous = NORMAL')

  migrate(db)
  seed(db)

  console.log(`[db] ready at ${file}`)
  return db
}

function migrate(d: Database.Database): void {
  const current = d.pragma('user_version', { simple: true }) as number

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    d.exec('BEGIN')
    try {
      d.exec(m.sql)
      d.pragma(`user_version = ${m.version}`)
      d.exec('COMMIT')
      console.log(`[db] migrated to v${m.version}`)
    } catch (err) {
      d.exec('ROLLBACK')
      throw err
    }
  }
}

export function closeDb(): void {
  db?.close()
  db = null
}
