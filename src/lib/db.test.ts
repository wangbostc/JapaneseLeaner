import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { KikitoriDB, sampleUid } from './db'
import { createStore } from './store'

// Later than the real clock: stamps never go backwards, so a T0 in the past would be overtaken by
// the time records are really written (this was 2026-09-25 and started failing that morning).
const T0 = Date.UTC(2099, 8, 25, 9)
const names: string[] = []
const fresh = () => {
  const name = `db-test-${names.length}-${Math.random()}`
  names.push(name)
  return name
}
afterEach(async () => {
  await Promise.all(names.splice(0).map((n) => Dexie.delete(n)))
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('schema v2 upgrade', () => {
  it('backfills uids and updatedAt for data written by v1', async () => {
    const name = fresh()
    // A database as the previous release left it.
    const v1 = new Dexie(name)
    v1.version(1).stores({ lessons: '++id, createdAt', media: '++id', cards: '++id, lessonId, card.due, [lessonId+front]', logs: '++id, lessonId, at', words: 'lemma' })
    await v1.table('lessons').bulkAdd([
      { title: '私の朝', builtIn: true, createdAt: T0, sentences: [], progress: { roundsDone: 1, lastCompletedAt: T0 }, resume: null, hard: [] },
      { title: 'My podcast', createdAt: T0 + 1, sentences: [], progress: { roundsDone: 0, lastCompletedAt: null }, resume: null, hard: [], mediaId: 1 },
    ])
    await v1.table('media').add({ blob: new Blob(['x']), name: 'a.mp3' })
    await v1.table('cards').add({ lessonId: 2, kind: 'word', front: '雨', reading: 'あめ', context: '雨', card: { due: new Date(T0) }, createdAt: T0 + 5 })
    await v1.table('logs').add({ lessonId: 1, step: 'intensive', mode: 'input', ms: 1000, at: T0 + 9 })
    v1.close()

    const db = new KikitoriDB(name)
    const [sample, podcast] = await db.lessons.orderBy('createdAt').toArray()
    expect(sample.uid).toBe(sampleUid('私の朝')) // same on every device
    expect(podcast.uid).toMatch(UUID)
    expect([sample.updatedAt, podcast.updatedAt]).toEqual([T0, T0 + 1])
    expect(sample.progress).toEqual({ roundsDone: 1, lastCompletedAt: T0 }) // data kept
    const [card] = await db.cards.toArray()
    expect(card).toMatchObject({ updatedAt: T0 + 5, lessonId: 2 })
    expect(card.uid).toMatch(UUID)
    expect((await db.logs.toArray())[0]).toMatchObject({ updatedAt: T0 + 9, lessonUid: sampleUid('私の朝') })
    expect((await db.media.toArray())[0].uid).toMatch(UUID)
    db.close()
  })
})

describe('sync bookkeeping', () => {
  it('gives every new record a uid and bumps updatedAt on every change', async () => {
    const s = createStore(new KikitoriDB(fresh()))
    const id = await s.createLesson({ title: 't', sentences: [] }, T0)
    const created = (await s.db.lessons.get(id))!
    expect(created.uid).toMatch(UUID)
    expect(created.updatedAt).toBe(T0)

    const before = Date.now()
    await s.setHard(id, 0, true)
    expect((await s.db.lessons.get(id))!.updatedAt).toBeGreaterThanOrEqual(before)

    const card = await s.addCard({ lessonId: id, kind: 'word', front: '雨', reading: 'あめ', context: '雨' }, T0)
    expect((await s.db.cards.get(card))!.uid).toMatch(UUID)
    s.db.close()
  })

  it('seeds sample lessons with deterministic uids', async () => {
    const { seedOnce } = await import('./seed')
    const s = createStore(new KikitoriDB(fresh()))
    await seedOnce(s)
    const uids = (await s.db.lessons.toArray()).map((l) => l.uid)
    expect(uids).toEqual(['sample:私の朝', 'sample:週末のカフェ', 'sample:雨の日の過ごし方'])
    // The oldest possible version: a tombstone from another device always beats it.
    expect((await s.db.lessons.toArray()).map((l) => l.updatedAt)).toEqual([0, 0, 0])
    s.db.close()
  })

  it('gives built-in samples their shared uid however they are created', async () => {
    const db = new KikitoriDB(fresh())
    await db.lessons.bulkAdd([
      { title: '私の朝', builtIn: true, sentences: [], progress: { roundsDone: 0, lastCompletedAt: null }, resume: null, hard: [], createdAt: T0 },
      { title: 'mine', sentences: [], progress: { roundsDone: 0, lastCompletedAt: null }, resume: null, hard: [], createdAt: T0 },
    ])
    const [sample, mine] = await db.lessons.orderBy('id').toArray()
    expect(sample.uid).toBe(sampleUid('私の朝'))
    expect(mine.uid).toMatch(UUID)
    db.close()
  })

  it('logs remember their lesson uid, so they still name it after the lesson is deleted', async () => {
    const s = createStore(new KikitoriDB(fresh()))
    const id = await s.createLesson({ title: 't', sentences: [] }, T0)
    const { uid } = (await s.db.lessons.get(id))!
    await s.log({ lessonId: id, step: 'intensive', mode: 'input', ms: 1000, at: T0 })
    await s.deleteLesson(id, T0 + 1)
    expect((await s.db.logs.toArray())[0].lessonUid).toBe(uid)
    s.db.close()
  })

  it('leaves tombstones for deleted lessons, their audio and cards, and removed cards', async () => {
    const s = createStore(new KikitoriDB(fresh()))
    const id = await s.createLesson({ title: 't', sentences: [], media: { blob: new Blob(['x']), name: 'a.mp3' } }, T0)
    const c1 = await s.addCard({ lessonId: id, kind: 'word', front: '一', reading: 'いち', context: '一' }, T0)
    const c2 = await s.addCard({ lessonId: id, kind: 'word', front: '二', reading: 'に', context: '二' }, T0)
    const lesson = (await s.db.lessons.get(id))!
    const media = (await s.db.media.toArray())[0]
    const [card1, card2] = await s.db.cards.bulkGet([c1, c2])

    await s.removeCard(c1, T0 + 1)
    await s.deleteLesson(id, T0 + 2)

    const tombs = (await s.db.deletions.toArray()).map(({ uid, table, at }) => ({ uid, table, at }))
    expect(tombs).toEqual([
      { uid: card1!.uid, table: 'cards', at: T0 + 1 },
      { uid: lesson.uid, table: 'lessons', at: T0 + 2 },
      { uid: media.uid, table: 'media', at: T0 + 2 },
      { uid: card2!.uid, table: 'cards', at: T0 + 2 },
    ])
    expect(await s.db.lessons.count()).toBe(0)
    s.db.close()
  })
})
