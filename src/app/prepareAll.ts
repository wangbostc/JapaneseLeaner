import { useSyncExternalStore } from 'react'
import type { Lesson } from '@kikitori/core/model'
import type { EngineVoiceId } from '@kikitori/core/voices'
import { prepareMissing, type PrepareProgress } from './neuralVoice'

/**
 * "Prepare all lessons": every lesson's sentences in the chosen engine voice, uploaded for the
 * learner's other devices. One run at a time, kept here rather than in a screen, so it carries on
 * while the learner moves around the app; any screen can show it or stop it.
 */
export type PrepareAllState =
  | { kind: 'idle' }
  | { kind: 'running'; voice: EngineVoiceId; lessons: number; progress: PrepareProgress }
  | { kind: 'done'; voice: EngineVoiceId; lessons: number; progress: PrepareProgress; stopped: boolean }
  | { kind: 'error'; voice: EngineVoiceId; message: string; progress: PrepareProgress | null }

let state: PrepareAllState = { kind: 'idle' }
let controller: AbortController | null = null
const listeners = new Set<() => void>()
const set = (next: PrepareAllState) => {
  state = next
  listeners.forEach((l) => l())
}

/** The current run, outside React. */
export const prepareAllState = () => state

export const usePrepareAll = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state,
  )

/** The lessons it covers: those read aloud (a lesson with its own recording needs no voice). */
export const preparable = (lessons: readonly Lesson[]) => lessons.filter((l) => !l.mediaId && l.sentences.length)

type Prepare = typeof prepareMissing

export async function prepareAll(lessons: readonly Lesson[], voice: EngineVoiceId, prepare: Prepare = prepareMissing): Promise<void> {
  if (state.kind === 'running') return
  const chosen = preparable(lessons)
  controller = new AbortController()
  const signal = controller.signal
  let last: PrepareProgress | null = null
  const progress = (p: PrepareProgress) => {
    last = p
    set({ kind: 'running', voice, lessons: chosen.length, progress: p })
  }
  progress({ done: 0, total: 0, failed: 0 })
  try {
    const result = await prepare(
      chosen.flatMap((l) => l.sentences.map((s) => s.text)),
      voice,
      progress,
      { signal },
    )
    set({ kind: 'done', voice, lessons: chosen.length, progress: result, stopped: false })
  } catch (e) {
    if (signal.aborted) set({ kind: 'done', voice, lessons: chosen.length, progress: last ?? { done: 0, total: 0, failed: 0 }, stopped: true })
    else set({ kind: 'error', voice, message: e instanceof Error ? e.message : String(e), progress: last })
  } finally {
    controller = null
  }
}

export const stopPrepareAll = () => controller?.abort()

/** Back to idle (after a finished or failed run has been seen). */
export const resetPrepareAll = () => state.kind !== 'running' && set({ kind: 'idle' })
