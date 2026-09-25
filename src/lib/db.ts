import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { LessonProgress, Step } from './schedule'
import type { Cue } from './subtitles'
import type { Card } from './srs'

export type UiLang = 'en' | 'zh'

export interface Sentence extends Cue {
  translations?: Partial<Record<UiLang, string>>
}

/** Where to resume inside the current round. */
export interface Resume {
  round: number
  stepIndex: number
  sentenceIndex: number
  /** The hard-sentence drill's queue, frozen when the step began. */
  queue?: number[]
}

/** Sync identity: stable across devices, unlike the local auto-increment `id`. */
export interface Synced {
  uid: string
  /** Last local change (epoch ms); sync resolves conflicts with it. */
  updatedAt: number
  /** The updatedAt last exchanged with the server (device-local): unchanged since then means nothing to push. */
  syncedVersion?: number
}

export interface Lesson extends Partial<Synced> {
  id?: number
  title: string
  level?: string
  sentences: Sentence[]
  /** Id into `media`; absent for text-only lessons voiced by TTS. */
  mediaId?: number
  /** The audio's uid: lets a synced lesson find its audio once that has downloaded. */
  mediaUid?: string
  progress: LessonProgress
  resume: Resume | null
  /** Sentence indices the learner marked as hard. */
  hard: number[]
  createdAt: number
  builtIn?: boolean
}

export interface Media extends Partial<Synced> {
  id?: number
  blob: Blob
  name: string
}

export interface Flashcard extends Partial<Synced> {
  id?: number
  lessonId: number
  kind: 'word' | 'sentence'
  /** The word (dictionary form) or the whole sentence. */
  front: string
  reading: string
  /** The sentence it was saved from, shown as context on the back. */
  context: string
  card: Card
  createdAt: number
}

export interface PracticeLog extends Partial<Synced> {
  id?: number
  lessonId: number
  /** The lesson's uid, kept so the log still names its lesson after the lesson is deleted. */
  lessonUid?: string | null
  step: Step | 'flashcards'
  /** Listening counts as input; shadowing and retelling as output. */
  mode: 'input' | 'output'
  ms: number
  at: number
}

export interface KnownWord {
  lemma: string
  firstSeen: number
}

/** A deleted record, kept so the deletion can reach other devices. */
export interface Deletion {
  id?: number
  uid: string
  table: 'lessons' | 'media' | 'cards'
  at: number
}

/** Built-in sample lessons get the same uid on every device, so syncing doesn't duplicate them. */
export const sampleUid = (title: string) => `sample:${title}`

const newUid = () => crypto.randomUUID()

const SYNC_APPLY = Symbol('syncApply')

/** Marks a transaction as applying server changes: the stamping hooks leave updatedAt alone. */
export function markSyncApply(trans: Transaction) {
  ;(trans as unknown as Record<symbol, boolean>)[SYNC_APPLY] = true
}
const isSyncApply = (trans: Transaction) => (trans as unknown as Record<symbol, boolean>)[SYNC_APPLY] === true

/**
 * A change time that is always later than the version it replaces, even if this device's clock
 * is behind the device that wrote that version: otherwise the newer edit would lose the merge.
 */
export const nextStamp = (previous: number | undefined, now = Date.now()) => Math.max(now, (previous ?? 0) + 1)

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
