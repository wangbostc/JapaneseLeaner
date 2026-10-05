import type { WireCard, WireLesson } from './syncWire'

/**
 * How two versions of the same record combine. Shared by the server (merging uploads) and
 * the tests; the rules are deliberately simple and one-directional so any device reaching the
 * server in any order ends at the same state.
 */

/**
 * The newer edit wins for the lesson's content and study state, but progress never goes
 * backwards: a device that hasn't synced can't undo a round finished elsewhere.
 */
export function mergeLesson(a: WireLesson, b: WireLesson): WireLesson {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a]
  const progress = aheadProgress(older.progress, newer.progress)
  // Keep the resume point only if it belongs to the round we ended up on.
  const resume = newer.resume?.round === progress.roundsDone ? newer.resume : null
  return { ...newer, progress, resume }
}

function aheadProgress(x: WireLesson['progress'], y: WireLesson['progress']): WireLesson['progress'] {
  if (x.roundsDone !== y.roundsDone) return x.roundsDone > y.roundsDone ? x : y
  return (x.lastCompletedAt ?? 0) >= (y.lastCompletedAt ?? 0) ? x : y
}

/** The card reviewed most recently wins (its schedule reflects every review); ties fall back to updatedAt. */
export function mergeCard(a: WireCard, b: WireCard): WireCard {
  const ra = a.card.last_review ? Date.parse(a.card.last_review) : 0
  const rb = b.card.last_review ? Date.parse(b.card.last_review) : 0
  if (ra !== rb) return ra > rb ? a : b
  return a.updatedAt >= b.updatedAt ? a : b
}

/** A record edited after its deletion comes back; otherwise the deletion stands. Samples (updatedAt 0) always lose. */
export const survivesDeletion = (record: { updatedAt: number }, deletedAt: number) => record.updatedAt > deletedAt
