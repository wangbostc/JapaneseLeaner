import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CORE_WORDS, coreRank, coreUid, introduceCoreWords } from '../../src/coreWords'
import type { Database } from '../../src/database'
import { createStore } from '../../src/store'
import type { Backend } from './backend'

// Local times (tests run in Australia/Sydney; see the setup files).
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

/** Introducing the core words, which every storage backend must reproduce. */
export function coreWordsContract(backend: Backend) {
  let db: Database
  beforeEach(() => {
    db = backend.open()
  })
  afterEach(() => backend.cleanup())
  const fronts = async () => (await db.cards.all()).map((c) => c.front)

  describe(`core words (${backend.name})`, () => {
    it('introduces the most frequent words first, up to the day’s limit, once a day', async () => {
      expect(await introduceCoreWords(db, 10, at(7, 9))).toBe(10)
      expect(await fronts()).toEqual(CORE_WORDS.slice(0, 10).map(([w]) => w))
      expect(await introduceCoreWords(db, 10, at(7, 18))).toBe(0) // same day
      expect(await introduceCoreWords(db, 20, at(7, 19))).toBe(10) // a higher limit tops up
      expect(await introduceCoreWords(db, 10, at(8, 9))).toBe(10) // the next day
      expect(await db.cards.count()).toBe(30)
      expect(await introduceCoreWords(db, 0, at(9, 9))).toBe(0) // off
      const [card] = await db.cards.all()
      expect(card).toMatchObject({ uid: coreUid(CORE_WORDS[0][0]), lessonId: 0, updatedAt: 0, kind: 'word', reading: CORE_WORDS[0][1], context: '' })
      expect(coreRank(card)).toBe(1)
      expect((await createStore(db).dueCards(at(7, 9))).length).toBe(10) // due straight away
    })

    it('counts days at local midnight', async () => {
      expect(await introduceCoreWords(db, 5, at(7, 23, 30))).toBe(5)
      expect(await introduceCoreWords(db, 5, at(7, 23, 59))).toBe(0)
      expect(await introduceCoreWords(db, 5, at(8, 0, 30))).toBe(5) // half an hour later, a new day
    })

    it('skips words deleted here and words already saved from a lesson', async () => {
      const store = createStore(db)
      const lesson = await store.createLesson({ title: 'l', sentences: [] })
      await store.addCard({ lessonId: lesson, kind: 'word', front: CORE_WORDS[1][0], reading: CORE_WORDS[1][1], context: 'x' })
      await introduceCoreWords(db, 3, at(7, 9))
      expect(await fronts()).toEqual([CORE_WORDS[1][0], CORE_WORDS[0][0], CORE_WORDS[2][0], CORE_WORDS[3][0]])
      const first = (await db.cards.where('uid', [coreUid(CORE_WORDS[0][0])]))[0]
      await store.removeCard(first.id!)
      await introduceCoreWords(db, 3, at(8, 9))
      expect(await fronts()).not.toContain(CORE_WORDS[0][0]) // deleted stays deleted
      expect(await db.cards.count()).toBe(6)
    })

    it('adds nothing twice when called twice at once', async () => {
      await Promise.all([introduceCoreWords(db, 10, at(7, 9)), introduceCoreWords(db, 10, at(7, 9))])
      expect(await db.cards.count()).toBe(10)
    })
  })
}
