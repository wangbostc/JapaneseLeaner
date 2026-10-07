// The shared Database interface over SQLite, for the macOS app (bun:sqlite) and for tests
// (node:sqlite). Each row is stored as JSON, plus the columns its queries need.
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  sameValue,
  stampEdit,
  stampNew,
  type CardTable,
  type Database,
  type SyncedTable,
  type SyncedTableName,
  type Table,
  type TransactionOptions,
} from '@kikitori/core/database'
import type { Deletion, Flashcard, KnownWord, Lesson, Media, PracticeLog } from '@kikitori/core/model'

/** The part of a synchronous SQLite driver used here: bun:sqlite and node:sqlite both fit. */
export interface SqlDriver {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
}
export interface SqlStatement {
  all(...params: SqlValue[]): unknown[]
  /** One row; undefined (node:sqlite) or null (bun:sqlite) when there is none. */
  get(...params: SqlValue[]): unknown
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
}
export type SqlValue = string | number | null | Uint8Array

const SCHEMA_VERSION = 1
const SCHEMA = `
  CREATE TABLE lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, updatedAt INTEGER NOT NULL, createdAt INTEGER, mediaUid TEXT, data TEXT NOT NULL);
  CREATE INDEX lessons_updatedAt ON lessons (updatedAt);
  CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, updatedAt INTEGER NOT NULL, type TEXT NOT NULL, bytes BLOB NOT NULL, data TEXT NOT NULL);
  CREATE INDEX media_updatedAt ON media (updatedAt);
  CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, updatedAt INTEGER NOT NULL, lessonId INTEGER, due INTEGER, data TEXT NOT NULL);
  CREATE INDEX cards_updatedAt ON cards (updatedAt);
  CREATE INDEX cards_lessonId ON cards (lessonId);
  CREATE INDEX cards_due ON cards (due);
  CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, updatedAt INTEGER NOT NULL, lessonId INTEGER, at INTEGER, data TEXT NOT NULL);
  CREATE INDEX logs_updatedAt ON logs (updatedAt);
  CREATE INDEX logs_lessonId ON logs (lessonId);
  CREATE TABLE words (lemma TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE deletions (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, tbl TEXT, data TEXT NOT NULL);
`

// JSON with Dates kept as Dates (FSRS card dates): {"$date": ms} on disk.
function encode(row: object): string {
  return JSON.stringify(row, function (this: Record<string, unknown>, key, value) {
    const raw = this[key]
    return raw instanceof Date ? { $date: raw.getTime() } : value
  })
}
function decode<T>(json: string): T {
  return JSON.parse(json, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$date === 'number' ? new Date(value.$date) : value,
  )
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** How one table maps rows to SQL. `columns` are what queries filter on; everything is in `data`. */
interface Layout<T> {
  name: string
  key: 'id' | 'lemma'
  /** Field name -> [column, value extracted from the row]. */
  columns: Record<string, [string, (row: T) => SqlValue]>
  synced?: SyncedTableName
}

const syncedColumns = <T extends { uid?: string; updatedAt?: number }>(): Layout<T>['columns'] => ({
  uid: ['uid', (r) => r.uid ?? null],
  updatedAt: ['updatedAt', (r) => r.updatedAt ?? null],
})

const LAYOUTS = {
  lessons: { name: 'lessons', key: 'id', synced: 'lessons', columns: { ...syncedColumns<Lesson>(), createdAt: ['createdAt', (r) => num(r.createdAt)], mediaUid: ['mediaUid', (r) => str(r.mediaUid)] } } as Layout<Lesson>,
  media: { name: 'media', key: 'id', synced: 'media', columns: syncedColumns<Media>() } as Layout<Media>,
  cards: {
    name: 'cards',
    key: 'id',
    synced: 'cards',
    columns: { ...syncedColumns<Flashcard>(), lessonId: ['lessonId', (r) => num(r.lessonId)], 'card.due': ['due', (r) => num(r.card?.due)] },
  } as Layout<Flashcard>,
  logs: { name: 'logs', key: 'id', synced: 'logs', columns: { ...syncedColumns<PracticeLog>(), lessonId: ['lessonId', (r) => num(r.lessonId)], at: ['at', (r) => num(r.at)] } } as Layout<PracticeLog>,
  words: { name: 'words', key: 'lemma', columns: {} } as Layout<KnownWord>,
  deletions: { name: 'deletions', key: 'id', columns: { uid: ['uid', (r) => r.uid], table: ['tbl', (r) => r.table] } } as Layout<Deletion>,
}

interface TxContext {
  syncApply: boolean
}

/**
 * Opens the shared Database interface on `driver`, creating the schema on first use.
 * One connection, one writer: transactions (and standalone calls) take turns, and a call made
 * inside a transaction, however deeply awaited, joins it.
 */
export function sqliteDatabase(driver: SqlDriver, newUid: () => string = () => crypto.randomUUID()): Database {
  const version = (driver.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version === 0) driver.exec(`BEGIN; ${SCHEMA} PRAGMA user_version = ${SCHEMA_VERSION}; COMMIT;`)
  else if (version > SCHEMA_VERSION) throw new Error(`database schema ${version} is newer than this app (${SCHEMA_VERSION})`)

  const tx = new AsyncLocalStorage<TxContext>()
  let queue: Promise<unknown> = Promise.resolve()
  /** Runs `fn` alone: after every transaction or call already waiting. */
  function exclusive<R>(fn: () => Promise<R>): Promise<R> {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  /** A standalone call joins the current transaction, or waits its turn and runs on its own. */
  const step = <R>(fn: () => R | Promise<R>): Promise<R> => (tx.getStore() ? Promise.resolve().then(fn) : exclusive(async () => fn()))

  function table<T extends object, K extends number | string>(layout: Layout<T>): Table<T, K> & { changedSince(ms: number): Promise<T[]>; query(condition: string, ...params: SqlValue[]): Promise<T[]> } {
    const { name, key, columns } = layout
    const isMedia = name === 'media'
    const colNames = Object.values(columns).map(([c]) => c)
    const select = `SELECT ${key}${isMedia ? ', type, bytes' : ''}, data FROM ${name}`

    function read(raw: unknown): T {
      const r = raw as Record<string, unknown>
      const row = decode<Record<string, unknown>>(r.data as string)
      row[key] = r[key]
      if (isMedia) row.blob = new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.type as string })
      return row as T
    }
    const readAll = (sql: string, ...params: SqlValue[]) => driver.prepare(sql).all(...params).map(read)
    const getRow = (k: K): T | undefined => {
      const r = driver.prepare(`${select} WHERE ${key} = ?`).get(k)
      return r == null ? undefined : read(r)
    }

    /** The blob's bytes, read before any SQL runs (reading a Blob is async). */
    const bytesOf = async (row: T): Promise<Uint8Array | undefined> => (isMedia ? new Uint8Array(await (row as unknown as Media).blob.arrayBuffer()) : undefined)

    /** Inserts `row` (keeping its key if it has one), or rewrites the row with `key` = `existingKey`. */
    function write(row: T, bytes: Uint8Array | undefined, existingKey?: K): K {
      const { [key]: k, ...rest } = row as Record<string, unknown>
      if (isMedia) delete rest.blob
      const cols = [...colNames, ...(isMedia ? ['type', 'bytes'] : []), 'data']
      const vals: SqlValue[] = [...Object.values(columns).map(([, extract]) => extract(row)), ...(isMedia ? [(row as unknown as Media).blob.type ?? '', bytes!] : []), encode(rest)]
      if (existingKey !== undefined) {
        driver.prepare(`UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${key} = ?`).run(...vals, existingKey)
        return existingKey
      }
      const keyed = k !== undefined && k !== null
      const names = keyed ? [key, ...cols] : cols
      const res = driver.prepare(`INSERT INTO ${name} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...(keyed ? [k as SqlValue] : []), ...vals)
      return (keyed ? k : Number(res.lastInsertRowid)) as K
    }

    /** New rows get sync identity; a replaced row is stamped like an update of what changed. */
    function stampForWrite(row: T, existing: T | undefined) {
      if (!layout.synced) return
      const r = row as { updatedAt?: number; uid?: string }
      if (!existing) return stampNew(layout.synced, r, newUid)
      const changes = changedFields(r, existing)
      const updatedAt = stampEdit(changes, existing as { updatedAt?: number }, tx.getStore()?.syncApply ?? false)
      if (updatedAt !== undefined) r.updatedAt = updatedAt
    }

    async function add(row: T): Promise<K> {
      const copy = { ...row }
      // Only audio waits to read its bytes: anything else takes its turn at once, so calls made
      // one after another (add, then count) run in that order, as in IndexedDB.
      const bytes = isMedia ? await bytesOf(copy) : undefined
      return step(() => {
        stampForWrite(copy, undefined)
        return write(copy, bytes)
      })
    }

    return {
      get: (k) => step(() => getRow(k)),
      all: () => step(() => readAll(`${select} ORDER BY ${key}`)),
      count: () => step(() => Number((driver.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n)),
      where: (field, values) =>
        step(() => {
          if (!values.length) return []
          const col = columns[field]?.[0] ?? (field === key ? key : undefined)
          // A column holds strings and numbers only; anything else (or an unindexed field) is matched in JS.
          if (col && values.every((v) => typeof v === 'string' || typeof v === 'number')) {
            return readAll(`${select} WHERE ${col} IN (${values.map(() => '?').join(', ')}) ORDER BY ${key}`, ...(values as unknown as SqlValue[]))
          }
          return readAll(`${select} ORDER BY ${key}`).filter((r) => values.some((v) => sameValue((r as Record<string, unknown>)[field], v)))
        }),
      add,
      async bulkAdd(rows) {
        for (const row of rows) await add(row)
      },
      async put(row) {
        const copy = { ...row }
        const bytes = isMedia ? await bytesOf(copy) : undefined
        return step(() => {
          const k = (copy as Record<string, unknown>)[key] as K | undefined
          const existing = k === undefined ? undefined : getRow(k)
          stampForWrite(copy, existing)
          return write(copy, bytes, existing ? k : undefined)
        })
      },
      async update(k, changes) {
        const blob = (changes as Partial<Media>).blob
        const bytes = isMedia && blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
        return step(() => {
          const existing = getRow(k)
          if (!existing) return
          const next = { ...existing, ...changes } as T
          // As in IndexedDB, a field set to undefined is removed.
          for (const [f, v] of Object.entries(changes)) if (v === undefined) delete (next as Record<string, unknown>)[f]
          if (layout.synced) {
            const updatedAt = stampEdit(changedFields(changes, existing), existing as { updatedAt?: number }, tx.getStore()?.syncApply ?? false)
            if (updatedAt !== undefined) (next as { updatedAt?: number }).updatedAt = updatedAt
          }
          write(next, isMedia ? (bytes ?? new Uint8Array((driver.prepare(`SELECT bytes FROM media WHERE id = ?`).get(k) as { bytes: Uint8Array }).bytes)) : undefined, k)
        })
      },
      delete: (keys) =>
        step(() => {
          const list = (Array.isArray(keys) ? keys : [keys]) as SqlValue[]
          if (list.length) driver.prepare(`DELETE FROM ${name} WHERE ${key} IN (${list.map(() => '?').join(', ')})`).run(...list)
        }),
      clear: () => step(() => void driver.prepare(`DELETE FROM ${name}`).run()),
      changedSince: (ms) => step(() => readAll(`${select} WHERE updatedAt > ? ORDER BY ${key}`, ms)),
      /** Rows matching a SQL condition on this table's columns, in key order. */
      query: (condition: string, ...params: SqlValue[]) => step(() => readAll(`${select} WHERE ${condition} ORDER BY ${key}`, ...params)),
    }
  }

  const cardTable = table<Flashcard, number>(LAYOUTS.cards)
  const cards: CardTable = { ...cardTable, dueBy: (when) => cardTable.query('due <= ?', when.getTime()) }

  return {
    lessons: table<Lesson, number>(LAYOUTS.lessons) as SyncedTable<Lesson>,
    media: table<Media, number>(LAYOUTS.media) as SyncedTable<Media>,
    cards,
    logs: table<PracticeLog, number>(LAYOUTS.logs) as SyncedTable<PracticeLog>,
    words: table<KnownWord, string>(LAYOUTS.words),
    deletions: table<Deletion, number>(LAYOUTS.deletions),
    transaction<R>(fn: () => Promise<R>, options?: TransactionOptions): Promise<R> {
      const outer = tx.getStore()
      if (outer) {
        // Joining: a nested call inherits sync-apply, and may also ask for it.
        return options?.syncApply && !outer.syncApply ? tx.run({ syncApply: true }, fn) : fn()
      }
      return exclusive(async () => {
        driver.exec('BEGIN IMMEDIATE')
        try {
          const result = await tx.run({ syncApply: options?.syncApply ?? false }, fn)
          driver.exec('COMMIT')
          return result
        } catch (e) {
          driver.exec('ROLLBACK')
          throw e
        }
      })
    },
  }
}

/** The fields of `changes` whose value differs from `existing`'s. */
function changedFields(changes: object, existing: object): object {
  const old = existing as Record<string, unknown>
  return Object.fromEntries(Object.entries(changes).filter(([k, v]) => !sameValue(old[k], v)))
}
