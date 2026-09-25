import type { Lesson } from './db'
import { dueAt, isGraduated } from './schedule'

export interface DueSummary {
  /** Lessons due now (first studies and reviews). */
  due: number
  /** Reviews due now; first studies of new lessons aren't "reminders". */
  reviewsDue: number
  /** The earliest future due time, if any. */
  nextDue: number | null
}

/** What reminders and the app badge need to know, from the same schedule the app uses. */
export function summarizeDue(lessons: Pick<Lesson, 'progress'>[], now: number): DueSummary {
  let due = 0
  let reviewsDue = 0
  let nextDue: number | null = null
  for (const l of lessons) {
    if (isGraduated(l.progress)) continue
    const at = dueAt(l.progress)!
    if (at <= now) {
      due++
      if (l.progress.roundsDone > 0) reviewsDue++
    } else if (nextDue === null || at < nextDue) {
      nextDue = at
    }
  }
  return { due, reviewsDue, nextDue }
}
