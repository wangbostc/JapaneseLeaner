import { describe, expect, it } from 'vitest'
import { mergeCard, mergeLesson, survivesDeletion } from './merge'
import type { WireCard, WireLesson } from './syncWire'

const lesson = (patch: Partial<WireLesson>): WireLesson => ({
  uid: 'L',
  updatedAt: 0,
  title: 't',
  sentences: [],
  progress: { roundsDone: 0, lastCompletedAt: null },
  resume: null,
  hard: [],
  createdAt: 0,
  ...patch,
})

describe('mergeLesson', () => {
  it('takes the newer edit', () => {
    const merged = mergeLesson(lesson({ updatedAt: 1, hard: [1] }), lesson({ updatedAt: 2, hard: [2] }))
    expect(merged.hard).toEqual([2])
  })

  it('never lets progress go backwards, whichever side is newer', () => {
    const ahead = lesson({ updatedAt: 1, progress: { roundsDone: 3, lastCompletedAt: 100 } })
    const staleButNewer = lesson({ updatedAt: 2, progress: { roundsDone: 1, lastCompletedAt: 50 }, hard: [7] })
    const m = mergeLesson(ahead, staleButNewer)
    expect(m.progress).toEqual({ roundsDone: 3, lastCompletedAt: 100 })
    expect(m.hard).toEqual([7]) // other fields still follow the newer edit
    expect(mergeLesson(staleButNewer, ahead)).toEqual(m) // order doesn't matter
  })

  it('drops a resume point from a round the lesson has moved past', () => {
    const done = lesson({ updatedAt: 1, progress: { roundsDone: 2, lastCompletedAt: 9 } })
    const midRound1 = lesson({ updatedAt: 2, progress: { roundsDone: 1, lastCompletedAt: 5 }, resume: { round: 1, stepIndex: 1, sentenceIndex: 0 } })
    expect(mergeLesson(done, midRound1).resume).toBeNull()
  })
})

describe('mergeCard', () => {
  const card = (last: string | undefined, updatedAt: number, reps: number): WireCard => ({
    uid: 'C',
    updatedAt,
    lessonUid: 'L',
    kind: 'word',
    front: '雨',
    reading: 'あめ',
    context: '雨',
    card: { due: '2026-01-01T00:00:00.000Z', last_review: last, stability: 1, difficulty: 1, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps, lapses: 0, state: 1 },
    createdAt: 0,
  })
  it('keeps the most recently reviewed version', () => {
    expect(mergeCard(card('2026-01-02T00:00:00Z', 5, 2), card('2026-01-03T00:00:00Z', 1, 3)).card.reps).toBe(3)
  })
  it('falls back to updatedAt when neither was reviewed', () => {
    expect(mergeCard(card(undefined, 5, 0), card(undefined, 1, 0)).updatedAt).toBe(5)
  })
})

describe('survivesDeletion', () => {
  it('lets a later edit resurrect, and never a sample', () => {
    expect(survivesDeletion({ updatedAt: 10 }, 5)).toBe(true)
    expect(survivesDeletion({ updatedAt: 5 }, 10)).toBe(false)
    expect(survivesDeletion({ updatedAt: 0 }, 1)).toBe(false)
  })
})
