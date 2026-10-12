import { gradeFor, type ShadowingResult } from '@kikitori/core/scoring'

const SELF_RATE_SCORE = { good: 90, ok: 65, bad: 30 } as const

/** A self-rated attempt, as a result: it has no kana to mark. */
export const selfRating = (k: keyof typeof SELF_RATE_SCORE): ShadowingResult => ({ score: SELF_RATE_SCORE[k], grade: gradeFor(SELF_RATE_SCORE[k]), marks: [] })
