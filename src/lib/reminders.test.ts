import { describe, expect, it } from 'vitest'
import { summarizeDue } from './reminders'

const H = 3_600_000
const T0 = Date.UTC(2026, 8, 25, 9)

describe('summarizeDue', () => {
  it('counts due reviews apart from new lessons and finds the next due time', () => {
    const lessons = [
      { progress: { roundsDone: 0, lastCompletedAt: null } }, // new: due now
      { progress: { roundsDone: 1, lastCompletedAt: T0 - 7 * H } }, // review 1 due 1h ago
      { progress: { roundsDone: 1, lastCompletedAt: T0 - 2 * H } }, // review 1 due in 4h
      { progress: { roundsDone: 2, lastCompletedAt: T0 - 2 * H } }, // review 2 due in 22h
      { progress: { roundsDone: 8, lastCompletedAt: T0 - 100 * H } }, // graduated
    ]
    expect(summarizeDue(lessons, T0)).toEqual({ due: 2, reviewsDue: 1, nextDue: T0 + 4 * H })
  })

  it('reports nothing for an empty library', () => {
    expect(summarizeDue([], T0)).toEqual({ due: 0, reviewsDue: 0, nextDue: null })
  })
})
