/**
 * The study plan for one lesson: a first study session, then seven spaced
 * review rounds. Each interval is counted from when the previous session was
 * actually completed, so a late review pushes every later round back.
 */

export type Step = 'intensive' | 'shadowing' | 'blind' | 'hardSentences' | 'retell'

export interface Round {
  index: number
  /** Delay after the previous session completes; 0 for the first study. */
  intervalMs: number
  steps: Step[]
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

const REVIEW_INTERVALS = [6 * HOUR, 1 * DAY, 2 * DAY, 4 * DAY, 7 * DAY, 14 * DAY, 28 * DAY]

export const ROUNDS: Round[] = [
  { index: 0, intervalMs: 0, steps: ['intensive', 'shadowing', 'blind', 'retell'] },
  ...REVIEW_INTERVALS.map((intervalMs, i) => ({
    index: i + 1,
    intervalMs,
    // The first review comes the same day, so it skips blind listening.
    steps: (i === 0 ? ['hardSentences', 'retell'] : ['blind', 'hardSentences', 'retell']) as Step[],
  })),
]

export const TOTAL_ROUNDS = ROUNDS.length

export interface LessonProgress {
  /** Rounds completed so far, 0..TOTAL_ROUNDS. */
  roundsDone: number
  /** When the most recent round was completed (epoch ms). */
  lastCompletedAt: number | null
}

export const isGraduated = (p: LessonProgress) => p.roundsDone >= TOTAL_ROUNDS

/** The round the learner is on next, or null once graduated. */
export const nextRound = (p: LessonProgress): Round | null => ROUNDS[p.roundsDone] ?? null

/** When the next round becomes due; the first study is due immediately. */
export function dueAt(p: LessonProgress): number | null {
  const round = nextRound(p)
  if (!round) return null
  if (p.lastCompletedAt === null) return 0
  return p.lastCompletedAt + round.intervalMs
}

export const isDue = (p: LessonProgress, now: number) => {
  const due = dueAt(p)
  return due !== null && due <= now
}

export function completeRound(p: LessonProgress, now: number): LessonProgress {
  if (isGraduated(p)) return p
  return { roundsDone: p.roundsDone + 1, lastCompletedAt: now }
}
