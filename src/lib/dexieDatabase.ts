import Dexie from 'dexie'
import type { CardTable, Database, SyncedTable, Table } from '@kikitori/core/database'
import type { Deletion, Flashcard, KnownWord, Lesson, Media, PracticeLog, Synced } from '@kikitori/core/model'
import { isSyncApply, markSyncApply, type KikitoriDB } from './db'

/** The shared Database interface over Dexie/IndexedDB. Stamping happens in KikitoriDB's hooks. */
export function dexieDatabase(db: KikitoriDB): Database {
  const tables = [db.lessons, db.media, db.cards, db.logs, db.words, db.deletions]

  // Dexie's EntityTable types don't infer through a generic; callers name T and K.
  // oxlint-disable-next-line no-explicit-any
  function table<T, K extends number | string>(t: Dexie.Table<any, any, any>): Table<T, K> {
    const primKey = t.schema.primKey.keyPath as string
    const indexed = (field: string) => field === primKey || field in t.schema.idxByName
    const byKey = (a: T, b: T) => {
      const x = (a as Record<string, unknown>)[primKey] as K
      const y = (b as Record<string, unknown>)[primKey] as K
      return x < y ? -1 : x > y ? 1 : 0
    }
    // Every method returns Dexie's own promise, never an async wrapper: Dexie follows the
    // current transaction only across awaits of its promises, so a native one would make the
    // next call start a transaction of its own (and the outer one commit early).
    return {
      get: (key) => t.get(key),
      all: () => t.toArray(),
      count: () => t.count(),
      where(field, values) {
        if (!values.length) return Dexie.Promise.resolve([])
        // Unindexed fields (lessons.mediaUid) scan the table; anyOf returns index order, so re-sort.
        const rows = indexed(field) ? t.where(field).anyOf(values as never) : t.filter((r) => values.includes((r as Record<string, unknown>)[field] as never))
        return rows.toArray().then((list) => list.sort(byKey))
      },
      add: (row) => t.add(row) as Promise<K>,
      bulkAdd: (rows) => t.bulkAdd(rows).then(() => undefined),
      put: (row) => t.put(row) as Promise<K>,
      update: (key, changes) => t.update(key, changes as never).then(() => undefined),
      delete: (keys) => (Array.isArray(keys) ? t.bulkDelete(keys as K[]) : t.delete(keys as K)),
      clear: () => t.clear(),
    }
  }

  // oxlint-disable-next-line no-explicit-any
  function synced<T extends Partial<Synced>>(t: Dexie.Table<any, any, any>): SyncedTable<T> {
    return { ...table<T, number>(t), changedSince: (ms) => t.where('updatedAt').above(ms).toArray() }
  }

  const cards: CardTable = { ...synced<Flashcard>(db.cards), dueBy: (when) => db.cards.where('card.due').belowOrEqual(when).toArray() }

  return {
    lessons: synced<Lesson>(db.lessons),
    media: synced<Media>(db.media),
    cards,
    logs: synced<PracticeLog>(db.logs),
    words: table<KnownWord, string>(db.words),
    deletions: table<Deletion, number>(db.deletions),
    transaction(fn, options) {
      // A nested transaction joins the outer one, and inherits its sync-apply marker.
      const outerApplies = Dexie.currentTransaction ? isSyncApply(Dexie.currentTransaction) : false
      return db.transaction('rw', tables, (tx) => {
        if (options?.syncApply || outerApplies) markSyncApply(tx)
        return fn()
      })
    },
  }
}
