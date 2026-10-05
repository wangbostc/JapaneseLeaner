import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'

export { Rating }
export type { Card, Grade }

const scheduler = fsrs({ enable_fuzz: false })

export const newCard = (now: Date): Card => createEmptyCard(now)

export const review = (card: Card, grade: Grade, now: Date): Card => scheduler.next(card, now, grade).card

/** Days until the card would next be due for each answer, for button labels. */
export function previewIntervals(card: Card, now: Date): Record<Grade, number> {
  const out = {} as Record<Grade, number>
  for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    out[grade] = (scheduler.next(card, now, grade).card.due.getTime() - now.getTime()) / 86_400_000
  }
  return out
}
