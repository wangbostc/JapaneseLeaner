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
}

export interface Lesson {
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

export interface Media {
  id?: number
  blob: Blob
  name: string
}

export interface Flashcard {
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

export interface PracticeLog {
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

export class KikitoriDB extends Dexie {
  lessons!: EntityTable<Lesson, 'id'>
  media!: EntityTable<Media, 'id'>
  cards!: EntityTable<Flashcard, 'id'>
  logs!: EntityTable<PracticeLog, 'id'>
  words!: EntityTable<KnownWord, 'lemma'>

  constructor(name = 'kikitori') {
    super(name)
    this.version(1).stores({
      lessons: '++id, createdAt',
      media: '++id',
      cards: '++id, lessonId, card.due, [lessonId+front]',
      logs: '++id, lessonId, at',
      words: 'lemma',
    })
  }
}

export const db = new KikitoriDB()
