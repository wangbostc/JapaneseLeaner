// What the shared logic (store, seed, sync, backup) needs from a storage backend. The web app
// implements it on Dexie/IndexedDB; the macOS app will implement it on SQLite. Both run the
// contract tests in ../test/contracts.
import { nextStamp, sampleUid, type Deletion, type Flashcard, type KnownWord, type Lesson, type Media, type PracticeLog, type Synced } from './model'

export interface Table<T, K extends number | string> {
  get(key: K): Promise<T | undefined>
  /** Every row, in key order. */
  all(): Promise<T[]>
  count(): Promise<number>
  /** Rows whose `field` equals any of `values`, in key order. */
  where<F extends keyof T & string>(field: F, values: readonly T[F][]): Promise<T[]>
  /** Adds a row and returns its key. A row with no `id` gets the next one. */
  add(row: T): Promise<K>
  bulkAdd(rows: T[]): Promise<void>
  /** Adds the row, or replaces the one with the same key. */
  put(row: T): Promise<K>
  /** Merges `changes` into the row with `key`; does nothing if there is none. */
  update(key: K, changes: Partial<T>): Promise<void>
  delete(keys: K | readonly K[]): Promise<void>
  clear(): Promise<void>
}

export interface SyncedTable<T extends Partial<Synced>> extends Table<T, number> {
  /** Rows with updatedAt > `ms`. */
  changedSince(ms: number): Promise<T[]>
}

export interface CardTable extends SyncedTable<Flashcard> {
  /** Cards due at or before `when`. */
  dueBy(when: Date): Promise<Flashcard[]>
}

export interface TransactionOptions {
  /**
   * The writes apply the server's versions: keep the updatedAt they carry instead of stamping
   * them as new local edits.
   */
  syncApply?: boolean
}

export interface Database {
  lessons: SyncedTable<Lesson>
  media: SyncedTable<Media>
  cards: CardTable
  logs: SyncedTable<PracticeLog>
  words: Table<KnownWord, string>
  deletions: Table<Deletion, number>
  /**
   * Runs `fn` atomically over every table. A call inside another transaction joins it.
   * Inside `fn`, await only this database's calls, directly: not another async function, a
   * fetch or a timer. IndexedDB commits a transaction as soon as it has nothing pending, and
   * Dexie loses track of the current one across a native promise.
   */
  transaction<R>(fn: () => Promise<R>, options?: TransactionOptions): Promise<R>
}

export type SyncedTableName = 'lessons' | 'media' | 'cards' | 'logs'

/** Fields that only mean something on this device and never travel. */
export const LOCAL_ONLY: ReadonlySet<string> = new Set(['mediaId', 'lessonId', 'syncedVersion'])

/**
 * Sync identity for a new record in a synced table: every write path gets a uid and an
 * updatedAt without having to remember to. Mutates `row`.
 */
export function stampNew(table: SyncedTableName, row: Partial<Synced>, newUid: () => string, now = Date.now()) {
  // Built-in samples keep their shared uid however they arrive (seeding, a v1 restore, ...).
  const sample = table === 'lessons' && (row as Lesson).builtIn
  row.uid ??= sample ? sampleUid((row as Lesson).title) : newUid()
  row.updatedAt ??= now
}

/**
 * The updatedAt an edit should get, or undefined to keep the row's. Edits that apply the
 * server's version, set updatedAt themselves, or touch only device-local fields aren't stamped.
 */
export function stampEdit(changes: object, previous: Partial<Synced>, syncApply: boolean, now = Date.now()): number | undefined {
  if (syncApply) return undefined
  const keys = Object.keys(changes)
  if ('updatedAt' in changes || keys.every((k) => LOCAL_ONLY.has(k))) return undefined
  return nextStamp(previous.updatedAt, now)
}
