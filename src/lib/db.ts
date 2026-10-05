import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { nextStamp, sampleUid, type Deletion, type Flashcard, type KnownWord, type Lesson, type Media, type PracticeLog, type Synced } from '@kikitori/core/model'

const newUid = () => crypto.randomUUID()

const SYNC_APPLY = Symbol('syncApply')

/** Marks a transaction as applying server changes: the stamping hooks leave updatedAt alone. */
export function markSyncApply(trans: Transaction) {
  ;(trans as unknown as Record<symbol, boolean>)[SYNC_APPLY] = true
}
const isSyncApply = (trans: Transaction) => (trans as unknown as Record<symbol, boolean>)[SYNC_APPLY] === true

/** Fields that only mean something on this device and never travel. */
const LOCAL_ONLY = new Set(['mediaId', 'lessonId', 'syncedVersion'])

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

    // Every write path gets a uid and a fresh updatedAt without having to remember to.
    for (const table of [this.lessons, this.media, this.cards, this.logs] as Dexie.Table<Partial<Synced>>[]) {
      table.hook('creating', (_key, obj) => {
        // Built-in samples keep their shared uid however they arrive (seeding, a v1 restore, ...).
        const sample = table === (this.lessons as unknown) && (obj as Lesson).builtIn
        obj.uid ??= sample ? sampleUid((obj as Lesson).title) : newUid()
        obj.updatedAt ??= Date.now()
      })
      table.hook('updating', (mods, _key, obj, trans) => {
        // Writes that apply the server's version keep its updatedAt, even when unchanged.
        if (isSyncApply(trans)) return undefined
        // Changes to device-local fields (which audio row a lesson points at) aren't edits to sync.
        const keys = Object.keys(mods)
        if ('updatedAt' in mods || keys.every((k) => LOCAL_ONLY.has(k))) return undefined
        return { updatedAt: nextStamp(obj.updatedAt) }
      })
    }
  }
}

export const db = new KikitoriDB()
