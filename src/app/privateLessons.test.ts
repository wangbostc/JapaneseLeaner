import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../lib/db'
import { forgetPrivate, loadPrivateLessons, prefs, releaseChapter } from './privateLessons'

const doc = {
  title: 'Test book L3 会話',
  book: 'Test book',
  chapter: 3,
  // A file on the computer that uploaded it: this device reads the lesson aloud instead.
  audio: '/Users/someone/L3.mp3',
  lines: [{ ja: 'おはよう。', en: 'Morning.', start: 0, end: 1 }],
  vocab: [{ word: '朝', reading: 'あさ', en: 'morning' }],
}

const api = (status: number, body?: unknown) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status })
const byUid = async (uid: string) => (await db.lessons.toArray()).find((l) => l.uid === uid)

beforeEach(async () => {
  await Promise.all([db.lessons.clear(), db.cards.clear(), db.deletions.clear()])
  await forgetPrivate()
  // Chapters opened and the one-time backfill, too: each test starts as a new device.
  prefs.setItem('kikitori.privateChapters', '[]')
  prefs.setItem('kikitori.privateCardsWaiting', '')
})

describe('private lessons from the server', () => {
  it('changes nothing where the server has none to offer', async () => {
    await loadPrivateLessons(api(404, { error: 'not found' }))
    expect(await byUid('private:Test book L3 会話')).toBeUndefined()
  })

  it("adds them read aloud, the chapter's words waiting until it's studied", async () => {
    await loadPrivateLessons(api(200, { docs: [doc] }))
    const lesson = await byUid('private:Test book L3 会話')
    expect(lesson).toMatchObject({ level: 'Test book · L3', mediaId: undefined })
    expect(lesson!.sentences).toEqual([{ text: 'おはよう。', start: null, end: null, translations: { en: 'Morning.' } }])
    const [card] = await db.cards.where('lessonId').equals(lesson!.id!).toArray()
    expect(card).toMatchObject({ front: '朝', gloss: 'morning' })
    expect(card.suspendedAt).toBe(card.createdAt)

    expect(await releaseChapter(lesson!.id!)).toBe(1)
    expect((await db.cards.get(card.id!))!.suspendedAt).toBeUndefined()
  })

  it('adds each lesson once, however often or at once it loads', async () => {
    const calls = vi.fn(api(200, { docs: [doc] }))
    await Promise.all([loadPrivateLessons(calls), loadPrivateLessons(calls)])
    expect(calls).toHaveBeenCalledTimes(1)
    await loadPrivateLessons(calls)
    expect((await db.lessons.toArray()).filter((l) => l.uid === 'private:Test book L3 会話')).toHaveLength(1)
    expect(await db.cards.count()).toBe(1)
  })

  it("ignores a lesson id that isn't one", async () => {
    expect(await releaseChapter(Number('nope'))).toBe(0)
  })
})
