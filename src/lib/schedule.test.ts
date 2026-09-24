import { describe, expect, it } from 'vitest'
import { completeRound, dueAt, isDue, isGraduated, nextRound, ROUNDS, TOTAL_ROUNDS, type LessonProgress } from './schedule'

const H = 3_600_000
const D = 24 * H
const T0 = Date.UTC(2026, 0, 1, 9)
const fresh: LessonProgress = { roundsDone: 0, lastCompletedAt: null }

describe('schedule', () => {
  it('has a first study plus seven reviews', () => {
    expect(TOTAL_ROUNDS).toBe(8)
    expect(ROUNDS.map((r) => r.intervalMs)).toEqual([0, 6 * H, 1 * D, 2 * D, 4 * D, 7 * D, 14 * D, 28 * D])
  })

  it('assigns the steps per round', () => {
    expect(ROUNDS[0].steps).toEqual(['intensive', 'shadowing', 'blind', 'retell'])
    expect(ROUNDS[1].steps).toEqual(['hardSentences', 'retell'])
    for (const r of ROUNDS.slice(2)) expect(r.steps).toEqual(['blind', 'hardSentences', 'retell'])
  })

  it('makes the first study due immediately', () => {
    expect(dueAt(fresh)).toBe(0)
    expect(isDue(fresh, T0)).toBe(true)
  })

  it('counts each interval from the previous completion', () => {
    let p = completeRound(fresh, T0)
    expect(dueAt(p)).toBe(T0 + 6 * H)
    expect(isDue(p, T0 + 6 * H - 1)).toBe(false)
    expect(isDue(p, T0 + 6 * H)).toBe(true)

    // Review 1 is done two days late; review 2 is 1 day after THAT.
    const late = T0 + 2 * D
    p = completeRound(p, late)
    expect(p).toEqual({ roundsDone: 2, lastCompletedAt: late })
    expect(dueAt(p)).toBe(late + 1 * D)
  })

  it('graduates after the 28-day review', () => {
    let p = fresh
    let t = T0
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      t += ROUNDS[i].intervalMs
      p = completeRound(p, t)
    }
    expect(t).toBe(T0 + 56 * D + 6 * H)
    expect(isGraduated(p)).toBe(true)
    expect(nextRound(p)).toBeNull()
    expect(dueAt(p)).toBeNull()
    expect(completeRound(p, t + D)).toBe(p)
  })
})
