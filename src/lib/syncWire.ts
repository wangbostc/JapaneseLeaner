// Self-contained on purpose: the Worker imports this, and it can't pull in Dexie's DOM types.

type Step = 'intensive' | 'shadowing' | 'blind' | 'hardSentences' | 'retell'

export interface WireSentence {
  start: number | null
  end: number | null
  text: string
  translations?: Partial<Record<'en' | 'zh', string>>
}

export interface WireProgress {
  roundsDone: number
  lastCompletedAt: number | null
}

export interface WireResume {
  round: number
  stepIndex: number
  sentenceIndex: number
  queue?: number[]
}

/** FSRS card state (ts-fsrs Card), dates as ISO strings. */
export interface WireFsrsCard {
  due: string
  last_review?: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
}

/**
 * What travels between devices and the server. Local numeric ids never leave the device:
 * references between records use uids, and each device maps them to its own ids.
 */

export interface WireLesson {
  uid: string
  updatedAt: number
  title: string
  level?: string
  sentences: WireSentence[]
  mediaUid?: string | null
  progress: WireProgress
  resume: WireResume | null
  hard: number[]
  createdAt: number
  builtIn?: boolean
}

export interface WireCard {
  uid: string
  updatedAt: number
  lessonUid: string
  kind: 'word' | 'sentence'
  front: string
  reading: string
  context: string
  card: WireFsrsCard
  createdAt: number
}

export interface WireLog {
  uid: string
  updatedAt: number
  lessonUid: string | null
  step: Step | 'flashcards'
  mode: 'input' | 'output'
  ms: number
  at: number
}

/** Audio metadata; the bytes go to /api/media/:uid separately. */
export interface WireMedia {
  uid: string
  updatedAt: number
  name: string
  type: string
  size: number
}

export interface WireWord {
  lemma: string
  firstSeen: number
}

export interface WireDeletion {
  uid: string
  table: 'lessons' | 'media' | 'cards'
  at: number
}

export interface SyncBatch {
  lessons: WireLesson[]
  cards: WireCard[]
  logs: WireLog[]
  media: WireMedia[]
  words: WireWord[]
  deletions: WireDeletion[]
}

export interface SyncRequest extends SyncBatch {
  /** The last server sequence this device has seen; the reply carries everything newer. */
  since: number
}

export interface SyncResponse extends SyncBatch {
  seq: number
}

export const emptyBatch = (): SyncBatch => ({ lessons: [], cards: [], logs: [], media: [], words: [], deletions: [] })
