import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { sameValue, stampEdit, stampNew, type SyncedTableName } from '@kikitori/core/database'
import { sampleUid, type Deletion, type Flashcard, type KnownWord, type Lesson, type Media, type PracticeLog, type Synced } from '@kikitori/core/model'

const newUid = () => crypto.randomUUID()

const SYNC_APPLY = Symbol('syncApply')

/** Marks a transaction as applying server changes: the stamping hooks leave updatedAt alone. */
export function markSyncApply(trans: Transaction) {
  ;(trans as unknown as Record<symbol, boolean>)[SYNC_APPLY] = true
}
export const isSyncApply = (trans: Transaction) => (trans as unknown as Record<symbol, boolean>)[SYNC_APPLY] === true

/**
 * The fields an update really changes. Dexie's `mods` (a diff of the row) compares arrays and
 * Dates by reference, so it lists every array field of a lesson as changed on any update; that
 * made a local-only edit (linking downloaded audio) count as a synced one.
 */
function realChanges(mods: object, row: object): object {
  const at = (path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], row)
  return Object.fromEntries(Object.entries(mods).filter(([path, value]) => !sameValue(at(path), value)))
}

export class KikitoriDB extends Dexie {
  lessons!: EntityTable<Lesson, 'id'>
  media!: EntityTable<Media, 'id'>
  cards!: EntityTable<Flashcard, 'id'>
  logs!: EntityTable<PracticeLog, 'id'>
  words!: EntityTable<KnownWord, 'lemma'>
  deletions!: EntityTable<Deletion, 'id'>

  constructor(name = 'kikitori') {
    super(name)
    this.version(1).stores({
      lessons: '++id, createdAt',
      media: '++id',
      cards: '++id, lessonId, card.due, [lessonId+front]',
      logs: '++id, lessonId, at',
      words: 'lemma',
    })
    // v2: sync identity (uid) and change time (updatedAt) on every synced record, plus tombstones.
    this.version(2)
      .stores({
        lessons: '++id, createdAt, &uid, updatedAt',
        media: '++id, &uid, updatedAt',
        cards: '++id, lessonId, card.due, [lessonId+front], &uid, updatedAt',
        logs: '++id, lessonId, at, &uid, updatedAt',
        words: 'lemma',
        deletions: '++id, &uid, table',
      })
      .upgrade(async (tx) => {
        const now = Date.now()
        const lessonUids = new Map<number, string>()
        await tx
          .table('lessons')
          .toCollection()
          .modify((l: Lesson) => {
            l.uid = l.builtIn ? sampleUid(l.title) : newUid()
            l.updatedAt = l.createdAt ?? now
            lessonUids.set(l.id!, l.uid)
          })
        for (const table of ['media', 'cards']) {
          await tx
            .table(table)
            .toCollection()
            .modify((r: Partial<Synced> & { createdAt?: number }) => {
              r.uid = newUid()
              r.updatedAt = r.createdAt ?? now
            })
        }
        // Logs of lessons already deleted in v1 keep lessonUid null: their lesson is gone everywhere.
        await tx
          .table('logs')
          .toCollection()
          .modify((r: PracticeLog) => {
            r.uid = newUid()
            r.updatedAt = r.at ?? now
            r.lessonUid = lessonUids.get(r.lessonId) ?? null
          })
      })

    // Every write path gets a uid and a fresh updatedAt, by the rules every backend shares.
    for (const name of ['lessons', 'media', 'cards', 'logs'] as SyncedTableName[]) {
      const table = this.table(name) as Dexie.Table<Partial<Synced>>
      table.hook('creating', (_key, obj) => stampNew(name, obj, newUid))
      table.hook('updating', (mods, _key, obj, trans) => {
        const updatedAt = stampEdit(realChanges(mods, obj), obj, isSyncApply(trans))
        return updatedAt === undefined ? undefined : { updatedAt }
      })
    }
  }
}

export const db = new KikitoriDB()
