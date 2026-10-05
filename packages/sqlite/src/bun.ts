import { Database as BunSqlite } from 'bun:sqlite'
import { sqliteDatabase, type SqlDriver } from './sqliteDatabase'

/** The macOS app's database file (or ':memory:'), with WAL so reads don't block on a writer. */
export function openBunDatabase(path: string) {
  const db = new BunSqlite(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  return sqliteDatabase(db as unknown as SqlDriver)
}
