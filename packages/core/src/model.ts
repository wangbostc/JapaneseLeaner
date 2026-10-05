// The records Kikitori stores, and the identity rules every storage backend shares.
import type { LessonProgress, Step } from './schedule'
import type { Card } from './srs'
import type { Cue } from './subtitles'

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

/**
 * A change time that is always later than the version it replaces, even if this device's clock
 * is behind the device that wrote that version: otherwise the newer edit would lose the merge.
 */
export const nextStamp = (previous: number | undefined, now = Date.now()) => Math.max(now, (previous ?? 0) + 1)
