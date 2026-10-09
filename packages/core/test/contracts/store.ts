import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Rating } from '../../src/srs'
import { createStore, type Store } from '../../src/store'
import type { Backend } from './backend'

const H = 3_600_000
const D = 24 * H
const T0 = Date.UTC(2026, 0, 10, 9)

/** The store's behaviour, which every storage backend must reproduce. */
export function storeContract(backend: Backend) {
  let s: Store
  beforeEach(() => {
    s = createStore(backend.open())
  })
  afterEach(() => backend.cleanup())

  const lesson = (title: string, now = T0) => s.createLesson({ title, sentences: [{ start: null, end: null, text: 'こんにちは。' }] }, now)

  describe(`store (${backend.name})`, () => {
  it('moves a lesson from due to upcoming as rounds complete', async () => {
    const id = await lesson('a')
    expect((await s.agenda(T0)).due.map((l) => l.title)).toEqual(['a'])

    await s.saveResume(id, { round: 0, stepIndex: 2, sentenceIndex: 0 })
    const p = await s.finishRound(id, 0, T0)
    expect(p).toEqual({ roundsDone: 1, lastCompletedAt: T0 })
    expect((await s.db.lessons.get(id))!.resume).toBeNull()

    const later = await s.agenda(T0 + 6 * H - 1)
    expect(later.due).toEqual([])
    expect(later.upcoming.map((l) => l.title)).toEqual(['a'])
    expect((await s.agenda(T0 + 6 * H)).due.map((l) => l.title)).toEqual(['a'])
  })

  it('ignores a repeated finish for the same round', async () => {
    const id = await lesson('a')
    const [p1, p2] = await Promise.all([s.finishRound(id, 0, T0), s.finishRound(id, 0, T0 + 1)])
    expect(p1).toEqual({ roundsDone: 1, lastCompletedAt: T0 })
    expect(p2).toEqual({ roundsDone: 1, lastCompletedAt: T0 })
    expect((await s.db.lessons.get(id))!.progress.roundsDone).toBe(1)
  })

  it('puts due reviews before new lessons', async () => {
    const a = await lesson('a', T0)
    await lesson('b', T0 + 1)
    const c = await lesson('c', T0 + 2)
    await s.finishRound(a, 0, T0 - D) // a's first review was due 18h ago
    await s.finishRound(c, 0, T0 - 2 * D) // c's was due 42h ago
    expect((await s.agenda(T0)).due.map((l) => l.title)).toEqual(['c', 'a', 'b'])
  })

  it('adds translations for one language without touching the others', async () => {
    const id = await s.createLesson(
      { title: 't', sentences: [{ start: null, end: null, text: '一。', translations: { en: 'One.' } }, { start: null, end: null, text: '二。' }] },
      T0,
    )
    await s.setTranslations(id, 'zh', ['一。', '二。'])
    expect((await s.db.lessons.get(id))!.sentences.map((x) => x.translations)).toEqual([{ en: 'One.', zh: '一。' }, { zh: '二。' }])
    await expect(s.setTranslations(id, 'en', ['only one'])).rejects.toThrow('translation count mismatch')
  })

  it('tracks hard sentences as a sorted set', async () => {
    const id = await lesson('a')
    await s.setHard(id, 3, true)
    await s.setHard(id, 1, true)
    await s.setHard(id, 3, true)
    expect((await s.db.lessons.get(id))!.hard).toEqual([1, 3])
    await s.setHard(id, 1, false)
    expect((await s.db.lessons.get(id))!.hard).toEqual([3])
  })

  it('saves a card once and schedules it with FSRS', async () => {
    const id = await lesson('a')
    const card = { lessonId: id, kind: 'word' as const, front: '天気', reading: 'てんき', context: '今日は天気がいい。' }
    const c1 = await s.addCard(card, T0)
    expect(await s.addCard(card, T0)).toBe(c1)
    expect((await s.dueCards(T0)).map((c) => c.front)).toEqual(['天気'])

    await s.gradeCard(c1, Rating.Good, T0)
    expect(await s.dueCards(T0)).toEqual([])
    const due = (await s.db.cards.get(c1))!.card.due.getTime()
    expect(due).toBeGreaterThan(T0)
    expect((await s.dueCards(due)).map((c) => c.front)).toEqual(['天気'])
  })

  it('undoes a grade not yet synced, leaving nothing to sync', async () => {
    const id = await lesson('a')
    const c = await s.addCard({ lessonId: id, kind: 'word', front: '天気', reading: 'てんき', context: '' }, T0)
    const before = (await s.db.cards.get(c))!
    const undo = (await s.gradeCard(c, Rating.Easy, T0 + H))!
    expect((await s.db.cards.get(c))!.updatedAt).toBeGreaterThan(before.updatedAt!)
    expect(await s.undoGrade(undo)).toBe(true)
    const after = (await s.db.cards.get(c))!
    expect(after.card).toEqual(before.card)
    expect(after.updatedAt).toBe(before.updatedAt)
    expect((await s.dueCards(T0 + H)).map((x) => x.front)).toEqual(['天気'])
  })

  it('keeps a grade the server already has', async () => {
    const id = await lesson('a')
    const c = await s.addCard({ lessonId: id, kind: 'word', front: '天気', reading: 'てんき', context: '' }, T0)
    const undo = (await s.gradeCard(c, Rating.Good, T0 + H))!
    // As sync marks a pushed card: its version is the server's.
    const graded = (await s.db.cards.get(c))!
    await s.db.cards.update(c, { syncedVersion: graded.updatedAt })
    expect(await s.undoGrade(undo)).toBe(false)
    expect((await s.db.cards.get(c))!.card).toEqual(graded.card)
    expect(await s.gradeCard(999_999, Rating.Good, T0)).toBeNull()
  })

  it('deletes a lesson with its cards', async () => {
    const id = await lesson('a')
    await s.addCard({ lessonId: id, kind: 'sentence', front: 'x', reading: 'x', context: 'x' }, T0)
    await s.deleteLesson(id)
    expect(await s.db.lessons.count()).toBe(0)
    expect(await s.db.cards.count()).toBe(0)
  })

  it('counts time, input/output split, unique words and the streak', async () => {
    const id = await lesson('a')
    await s.log({ lessonId: id, step: 'intensive', mode: 'input', ms: 60_000, at: T0 - D })
    await s.log({ lessonId: id, step: 'shadowing', mode: 'output', ms: 30_000, at: T0 })
    await s.log({ lessonId: id, step: 'retell', mode: 'output', ms: 0, at: T0 })
    expect(await s.addKnownWords(['天気', '今日', '天気'], T0)).toBe(2)
    expect(await s.addKnownWords(['天気', '雨'], T0)).toBe(1)

    const st = await s.stats(T0)
    expect(st).toMatchObject({ totalMs: 90_000, inputMs: 60_000, outputMs: 30_000, words: 3, cards: 0, streak: 2 })
    expect(st.lastWeek.map((d) => d.ms)).toEqual([0, 0, 0, 0, 0, 60_000, 30_000])
    expect(await s.db.logs.count()).toBe(2)
  })

  it('splits days at local midnight, not UTC midnight', async () => {
    // Tests run in Australia/Sydney (UTC+11 in January), see src/test/setup.ts.
    const beforeMidnight = new Date(2026, 0, 10, 23, 30).getTime()
    const afterMidnight = new Date(2026, 0, 11, 0, 30).getTime()
    expect(new Date(beforeMidnight).getUTCDate()).toBe(new Date(afterMidnight).getUTCDate()) // same UTC day
    const id = await lesson('a')
    await s.log({ lessonId: id, step: 'intensive', mode: 'input', ms: 60_000, at: beforeMidnight })
    await s.log({ lessonId: id, step: 'intensive', mode: 'input', ms: 30_000, at: afterMidnight })
    const st = await s.stats(afterMidnight)
    expect(st.streak).toBe(2)
    expect(st.lastWeek.slice(-2)).toEqual([
      { day: new Date(2026, 0, 10).getTime(), ms: 60_000 },
      { day: new Date(2026, 0, 11).getTime(), ms: 30_000 },
    ])
  })
})
}
