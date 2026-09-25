// Two devices syncing through the real Worker code (in-process) against a local D1 + R2.
// Lives outside the typecheck projects: it spans browser (Dexie) and Workers types.
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { KikitoriDB, sampleUid } from '../src/lib/db'
import { Rating } from '../src/lib/srs'
import { createStore } from '../src/lib/store'
import { initialSyncState, syncOnce, type Api, type SyncState } from '../src/lib/sync'
import { handleApi } from '../worker/index'
import { testEnv } from '../worker/testEnv'

const SETUP = 'integration-setup-code'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((f) => f()))
})

async function server() {
  const t = await testEnv({ SETUP_CODE: SETUP })
  cleanups.push(t.dispose)
  return t.env
}

/** A device: its own database, its own token, its own sync cursor. */
async function device(env: Awaited<ReturnType<typeof server>>, name: string) {
  const dbName = `sync-${name}-${Math.random()}`
  const store = createStore(new KikitoriDB(dbName))
  cleanups.push(async () => {
    store.db.close()
    await Dexie.delete(dbName)
  })
  const reg = await handleApi(
    new Request('https://kikitori.test/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': name }, body: JSON.stringify({ setupCode: SETUP, name }) }),
    env,
  )
  const { token } = (await reg.json()) as { token: string }
  const api: Api = (path, init = {}) => handleApi(new Request(`https://kikitori.test${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } }), env)
  let state: SyncState = initialSyncState()
  const sync = async () => {
    const r = await syncOnce(store.db, api, state)
    state = r.state
    return r
  }
  return { store, db: store.db, sync, state: () => state }
}

const byTitle = async (db: KikitoriDB, title: string) => (await db.lessons.toArray()).find((l) => l.title === title)

describe('sync between two devices', () => {
  it('copies a lesson with its audio, cards, logs and words to a new device', async () => {
    const env = await server()
    const a = await device(env, 'phone')
    const b = await device(env, 'laptop')
    const audio = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'audio/wav' })
    const id = await a.store.createLesson({ title: '散歩', sentences: [{ start: 0, end: 1, text: 'おはよう。' }], media: { blob: audio, name: 'clip.wav' } })
    await a.store.addCard({ lessonId: id, kind: 'word', front: '散歩', reading: 'さんぽ', context: 'おはよう。' })
    await a.store.log({ lessonId: id, step: 'intensive', mode: 'input', ms: 60_000, at: Date.now() })
    await a.store.addKnownWords(['散歩', '朝'])
    await a.sync()

    const r = await b.sync()
    expect(r.pulled).toBeGreaterThan(0)
    const lesson = await byTitle(b.db, '散歩')
    expect(lesson?.sentences[0].text).toBe('おはよう。')
    const media = await b.db.media.get(lesson!.mediaId!)
    expect([...new Uint8Array(await media!.blob.arrayBuffer())]).toEqual([1, 2, 3, 250])
    expect(media!.blob.type).toBe('audio/wav')
    const [card] = await b.db.cards.toArray()
    expect(card).toMatchObject({ front: '散歩', lessonId: lesson!.id })
    expect(card.card.due).toBeInstanceOf(Date)
    expect((await b.db.logs.toArray()).map((l) => [l.lessonId, l.ms])).toEqual([[lesson!.id, 60_000]])
    expect((await b.db.words.toArray()).map((w) => w.lemma).sort()).toEqual(['散歩', '朝'].sort())
  })

  it('never undoes a finished round from a stale device, and keeps its other edits', async () => {
    const env = await server()
    const a = await device(env, 'a')
    const b = await device(env, 'b')
    const id = await a.store.createLesson({ title: 'L', sentences: [{ start: null, end: null, text: '一。' }, { start: null, end: null, text: '二。' }] })
    await a.sync()
    await b.sync()
    const bId = (await byTitle(b.db, 'L'))!.id!

    await a.store.finishRound(id, 0) // A finishes the first study
    await a.sync()
    await new Promise((r) => setTimeout(r, 5))
    await b.store.setHard(bId, 1, true) // B, not yet synced, marks a sentence hard later
    await b.sync()
    await a.sync()

    for (const d of [a, b]) {
      const l = (await byTitle(d.db, 'L'))!
      expect(l.progress.roundsDone).toBe(1)
      expect(l.hard).toEqual([1])
    }
  })

  it('carries deletions, including the lesson’s cards', async () => {
    const env = await server()
    const a = await device(env, 'a')
    const b = await device(env, 'b')
    const id = await a.store.createLesson({ title: 'gone', sentences: [] })
    await a.store.addCard({ lessonId: id, kind: 'word', front: 'x', reading: 'x', context: 'x' })
    await a.sync()
    await b.sync()
    await b.store.deleteLesson((await byTitle(b.db, 'gone'))!.id!)
    await b.sync()
    await a.sync()
    expect(await byTitle(a.db, 'gone')).toBeUndefined()
    expect(await a.db.cards.count()).toBe(0)
  })

  it('does not duplicate the built-in samples, and a deleted sample stays deleted on a new install', async () => {
    const env = await server()
    const { seedOnce } = await import('../src/lib/seed')
    const a = await device(env, 'a')
    await seedOnce(a.store)
    await a.sync()
    await a.store.deleteLesson((await byTitle(a.db, '私の朝'))!.id!)
    await a.sync()

    const b = await device(env, 'b')
    await seedOnce(b.store) // fresh install seeds all three samples
    await b.sync()
    const titles = (await b.db.lessons.toArray()).map((l) => l.uid).sort()
    expect(titles).toEqual([sampleUid('週末のカフェ'), sampleUid('雨の日の過ごし方')].sort())
  })

  it('keeps the most recently reviewed version of a card', async () => {
    const env = await server()
    const a = await device(env, 'a')
    const b = await device(env, 'b')
    const id = await a.store.createLesson({ title: 'C', sentences: [] })
    const cardId = await a.store.addCard({ lessonId: id, kind: 'word', front: '雨', reading: 'あめ', context: '雨' })
    await a.sync()
    await b.sync()
    await a.store.gradeCard(cardId, Rating.Good)
    await a.sync()
    await b.sync()
    const [card] = await b.db.cards.toArray()
    expect(card.card.reps).toBe(1)
    expect(card.card.last_review).toBeInstanceOf(Date)
  })

  it('does not push back what it just pulled', async () => {
    const env = await server()
    const a = await device(env, 'a')
    const b = await device(env, 'b')
    await a.store.createLesson({ title: 'x', sentences: [] })
    await a.sync()
    await b.sync()
    expect((await b.sync()).pushed).toBe(0)
    expect((await a.sync()).pushed).toBe(0)
  })
})
