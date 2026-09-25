import Dexie, { type EntityTable } from 'dexie'
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
}

export interface Lesson extends Partial<Synced> {
  id?: number
  title: string
  level?: string
  sentences: Sentence[]
  /** Id into `media`; absent for text-only lessons voiced by TTS. */
  mediaId?: number
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
        media: '++id, &uid',
        cards: '++id, lessonId, card.due, [lessonId+front], &uid, updatedAt',
        logs: '++id, lessonId, at, &uid',
        words: 'lemma',
        deletions: '++id, &uid, table',
      })
      .upgrade(async (tx) => {
        const now = Date.now()
        await tx
          .table('lessons')
          .toCollection()
          .modify((l: Lesson) => {
            l.uid = l.builtIn ? sampleUid(l.title) : newUid()
            l.updatedAt = l.createdAt ?? now
          })
        for (const table of ['media', 'cards', 'logs']) {
          await tx
            .table(table)
            .toCollection()
            .modify((r: Partial<Synced> & { createdAt?: number; at?: number }) => {
              r.uid = newUid()
              r.updatedAt = r.createdAt ?? r.at ?? now
            })
        }
      })

    // Every write path gets a uid and a fresh updatedAt without having to remember to.
    for (const table of [this.lessons, this.media, this.cards, this.logs] as Dexie.Table<Partial<Synced>>[]) {
      table.hook('creating', (_key, obj) => {
        obj.uid ??= newUid()
        obj.updatedAt ??= Date.now()
      })
      table.hook('updating', (mods) => ('updatedAt' in mods ? undefined : { updatedAt: Date.now() }))
    }
  }
}

export const db = new KikitoriDB()
