// Two devices syncing through the real Worker code (in-process) against a local D1 + R2.
// Lives outside the typecheck projects: it spans browser (Dexie) and Workers types.
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportBackup, parseBackup, restoreBackup } from '@kikitori/core/backup'
import { sampleUid } from '@kikitori/core/model'
import { Rating } from '@kikitori/core/srs'
import type { Database } from '@kikitori/core/database'
import { createStore } from '@kikitori/core/store'
import { CORE_WORDS, coreUid, introduceCoreWords } from '@kikitori/core/coreWords'
import { initialSyncState, syncOnce, type Api, type SyncState } from '@kikitori/core/sync'
import { handleApi } from '../worker/index'
import { testEnv } from '../worker/testEnv'
import { dexieBackend } from '../src/test/dexieBackend'
import { sqliteDatabase, type SqlDriver } from '@kikitori/sqlite'
import type { Backend } from '@kikitori/core/test/contracts/backend'

// Devices store their data in IndexedDB (the web app) or SQLite (the macOS app). Every test
// runs with each, and a mixed pair (a Mac and a phone) syncs at the end.
const sqliteBackend: Backend = { name: 'SQLite', open: () => sqliteDatabase(new DatabaseSync(':memory:') as unknown as SqlDriver), cleanup: async () => {} }
const BACKENDS = [dexieBackend(), sqliteBackend]
let current: Backend = BACKENDS[0]

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
async function device(env: Awaited<ReturnType<typeof server>>, name: string, backend: Backend = current) {
  const store = createStore(backend.open())
  cleanups.push(backend.cleanup)
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
  const setState = (s: SyncState) => (state = s)
  const dev = { store, db: store.db, sync, state: () => state, setState }
  apis.set(dev, api)
  return dev
}

const apis = new WeakMap<object, Api>()
const apiFor = (dev: object) => apis.get(dev)!

const byTitle = async (db: Database, title: string) => (await db.lessons.all()).find((l) => l.title === title)

for (const backend of BACKENDS) {
  describe(`sync between two devices (${backend.name})`, () => {
    beforeAll(() => {
      current = backend
    })
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
      const [card] = await b.db.cards.all()
      expect(card).toMatchObject({ front: '散歩', lessonId: lesson!.id })
      expect(card.card.due).toBeInstanceOf(Date)
      expect((await b.db.logs.all()).map((l) => [l.lessonId, l.ms])).toEqual([[lesson!.id, 60_000]])
      expect((await b.db.words.all()).map((w) => w.lemma).sort()).toEqual(['散歩', '朝'].sort())
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
      const { seedOnce } = await import('@kikitori/core/seed')
      const a = await device(env, 'a')
      await seedOnce(a.store)
      await a.sync()
      await a.store.deleteLesson((await byTitle(a.db, '私の朝'))!.id!)
      await a.sync()

      const b = await device(env, 'b')
      await seedOnce(b.store) // fresh install seeds all the samples
      await b.sync()
      const titles = (await b.db.lessons.all()).map((l) => l.uid).sort()
      const { sampleLessons } = await import('@kikitori/core/samples')
      expect(titles).toEqual(sampleLessons().map((l) => sampleUid(l.title)).filter((uid) => uid !== sampleUid('私の朝')).sort())
    })

    it('keeps a sample deleted elsewhere deleted on a device that only adds it later', async () => {
      // Device B syncs (on a release without the sample) before it seeds: the deletion arrives
      // for a lesson it doesn't have yet, and must still stop the sample being added afterwards.
      const env = await server()
      const { seedOnce } = await import('@kikitori/core/seed')
      const a = await device(env, 'a')
      await seedOnce(a.store, () => undefined)
      await a.sync()
      await a.store.deleteLesson((await byTitle(a.db, '私の朝'))!.id!)
      await a.sync()
      const b = await device(env, 'b')
      await b.sync()
      await seedOnce(b.store, () => undefined)
      await b.sync()
      await a.sync()
      await b.sync()
      expect(await byTitle(b.db, '私の朝')).toBeUndefined()
      expect(await byTitle(a.db, '私の朝')).toBeUndefined()
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
      const [card] = await b.db.cards.all()
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

    it('links audio for lessons made before mediaUid existed', async () => {
      const env = await server()
      const a = await device(env, 'a')
      const b = await device(env, 'b')
      const id = await a.store.createLesson({ title: 'old audio', sentences: [], media: { blob: new Blob([new Uint8Array([9])], { type: 'audio/mpeg' }), name: 'a.mp3' } })
      await a.db.lessons.update(id, { mediaUid: undefined }) // as a pre-sync lesson row
      await a.sync()
      await b.sync()
      const lesson = (await byTitle(b.db, 'old audio'))!
      expect(lesson.mediaId).toBeDefined()
      expect((await b.db.media.get(lesson.mediaId!))!.name).toBe('a.mp3')
    })

    describe('with device clocks an hour apart', () => {
      afterEach(() => vi.restoreAllMocks())
      const skewed = async <T>(fn: () => Promise<T>) => {
        const real = Date.now.bind(Date)
        const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + 3_600_000)
        try {
          return await fn()
        } finally {
          spy.mockRestore()
        }
      }

      it('keeps an edit made on the device whose clock is behind', async () => {
        const env = await server()
        const a = await device(env, 'a')
        const b = await device(env, 'b') // B's clock runs an hour fast
        await a.store.createLesson({ title: 'L', sentences: [{ start: null, end: null, text: '一。' }, { start: null, end: null, text: '二。' }] })
        await a.sync()
        await skewed(async () => {
          await b.sync()
          await b.store.setHard((await byTitle(b.db, 'L'))!.id!, 0, true)
          await b.sync()
        })
        await a.sync()
        await a.store.setHard((await byTitle(a.db, 'L'))!.id!, 1, true) // later in real time, earlier by A's clock
        await a.sync()
        await skewed(() => b.sync())
        await a.sync()
        for (const d of [a, b]) expect((await byTitle(d.db, 'L'))!.hard).toEqual([0, 1])
      })

      it('deletes a lesson last edited by the fast device', async () => {
        const env = await server()
        const a = await device(env, 'a')
        const b = await device(env, 'b')
        await a.store.createLesson({ title: 'D', sentences: [] })
        await a.sync()
        await skewed(async () => {
          await b.sync()
          await b.store.setHard((await byTitle(b.db, 'D'))!.id!, 0, true)
          await b.sync()
        })
        await a.sync()
        await a.store.deleteLesson((await byTitle(a.db, 'D'))!.id!)
        await a.sync()
        await skewed(() => b.sync())
        expect(await byTitle(a.db, 'D')).toBeUndefined()
        expect(await byTitle(b.db, 'D')).toBeUndefined()
      })
    })

    it('pulls everything again after a backup restore (with the cursor reset the app does)', async () => {
      const env = await server()
      const a = await device(env, 'a')
      const b = await device(env, 'b')
      await a.store.createLesson({ title: 'mine', sentences: [] })
      await a.sync()
      const backup = parseBackup(await (await exportBackup(a.db)).text())
      await b.sync()
      await b.store.createLesson({ title: 'fromB', sentences: [] })
      await b.sync()
      await a.sync()
      expect(await byTitle(a.db, 'fromB')).toBeDefined()

      await restoreBackup(a.db, backup) // an older backup, without fromB
      a.setState({ ...initialSyncState(), uploaded: a.state().uploaded }) // what resetSyncCursor() does
      await a.sync()
      expect(await byTitle(a.db, 'fromB')).toBeDefined()
    })

    it('deletes a lesson again after another device’s later edit brought it back', async () => {
      const env = await server()
      const a = await device(env, 'a')
      const b = await device(env, 'b')
      const id = await a.store.createLesson({ title: 'R', sentences: [{ start: null, end: null, text: '一。' }] })
      await a.store.addCard({ lessonId: id, kind: 'word', front: 'x', reading: 'x', context: 'x' })
      await a.sync()
      await b.sync()
      await a.store.deleteLesson(id)
      await new Promise((r) => setTimeout(r, 5))
      await b.store.setHard((await byTitle(b.db, 'R'))!.id!, 0, true) // edited after A's delete: it wins
      await b.sync()
      await a.sync()
      await b.sync()
      const back = (await byTitle(a.db, 'R'))!
      expect(back).toBeDefined()
      await a.store.deleteLesson(back.id!) // must not hit the old tombstone's unique uid
      await a.sync()
      await b.sync()
      expect(await byTitle(a.db, 'R')).toBeUndefined()
      expect(await byTitle(b.db, 'R')).toBeUndefined()
    })

    it('converges instead of ping-ponging when a fast device keeps editing', async () => {
      const env = await server()
      const a = await device(env, 'a')
      const b = await device(env, 'b')
      const real = Date.now.bind(Date)
      const fast = () => vi.spyOn(Date, 'now').mockImplementation(() => real() + 3_600_000)
      await a.store.createLesson({ title: 'P', sentences: [0, 1, 2].map((i) => ({ start: null, end: null, text: `${i}。` })) })
      await a.sync()
      let spy = fast()
      await b.sync()
      await b.store.setHard((await byTitle(b.db, 'P'))!.id!, 0, true)
      await b.sync()
      spy.mockRestore()
      await a.sync()
      await a.store.setHard((await byTitle(a.db, 'P'))!.id!, 1, true)
      await a.sync()
      spy = fast()
      await b.sync()
      await b.store.setHard((await byTitle(b.db, 'P'))!.id!, 2, true)
      await b.sync()
      spy.mockRestore()
      const pushes: number[] = []
      for (let i = 0; i < 3; i++) pushes.push((await a.sync()).pushed)
      expect((await byTitle(a.db, 'P'))!.hard).toEqual([0, 1, 2])
      expect(pushes.slice(1)).toEqual([0, 0]) // settles; no repeated re-pushes
    })

    it('keeps a delete made while a sync is in flight (own echo, and another device’s edit)', async () => {
      const env = await server()
      const a = await device(env, 'a')
      const b = await device(env, 'b')
      const m = await a.store.createLesson({ title: 'M', sentences: [{ start: null, end: null, text: '一。' }] })
      await a.store.createLesson({ title: 'N', sentences: [{ start: null, end: null, text: '一。' }] })
      await a.sync()
      await b.sync()
      await b.store.setHard((await byTitle(b.db, 'N'))!.id!, 0, true) // B's edit to N arrives in A's next reply
      await b.sync()
      await a.store.setHard(m, 0, true) // M is in A's next push, so its echo comes back

      // Delete both on A after the push was gathered but before the reply is applied.
      const state = a.state()
      const { syncOnce: run } = await import('@kikitori/core/sync')
      let deleted = false
      const api: Api = async (path, init) => {
        if (path === '/api/sync' && !deleted) {
          deleted = true
          await a.store.deleteLesson((await byTitle(a.db, 'M'))!.id!)
          await a.store.deleteLesson((await byTitle(a.db, 'N'))!.id!)
        }
        return apiFor(a)(path, init)
      }
      a.setState((await run(a.db, api, state)).state)
      for (const d of [a, a, b, a]) await d.sync()
      for (const d of [a, b]) {
        expect(await byTitle(d.db, 'M')).toBeUndefined()
        expect(await byTitle(d.db, 'N')).toBeUndefined()
      }
    })

    it('pushes a change made in the same millisecond the sync started', async () => {
      const env = await server()
      const a = await device(env, 'a')
      const b = await device(env, 'b')
      const id = await a.store.createLesson({ title: 'S', sentences: [] }, 1000)
      await a.sync()
      await b.sync()
      const T = Date.now() + 10_000
      const { syncOnce: run } = await import('@kikitori/core/sync')
      let fired = false
      const api: Api = async (path, init) => {
        if (path === '/api/sync' && !fired) {
          fired = true
          await a.store.deleteLesson(id, T) // after the gather, stamped exactly at the start time
        }
        return apiFor(a)(path, init)
      }
      a.setState((await run(a.db, api, a.state(), () => T)).state)
      await a.sync()
      await b.sync()
      expect(await byTitle(b.db, 'S')).toBeUndefined()
    })

  })
}

describe('sync between a Mac (SQLite) and a phone (IndexedDB)', () => {
  it('carries a lesson with audio, cards and progress both ways, and deletions back', async () => {
    const env = await server()
    const mac = await device(env, 'mac', sqliteBackend)
    const phone = await device(env, 'phone', BACKENDS[0])
    const audio = new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/mp4' })
    const id = await mac.store.createLesson({ title: '散歩', sentences: [{ start: 0, end: 1, text: 'おはよう。' }], media: { blob: audio, name: 'walk.m4a' } })
    await mac.store.addCard({ lessonId: id, kind: 'word', front: '散歩', reading: 'さんぽ', context: 'おはよう。' })
    await mac.sync()

    await phone.sync()
    const onPhone = (await byTitle(phone.db, '散歩'))!
    expect([...new Uint8Array(await (await phone.db.media.get(onPhone.mediaId!))!.blob.arrayBuffer())]).toEqual([9, 8, 7])
    expect((await phone.db.cards.all()).map((c) => c.front)).toEqual(['散歩'])
    await phone.store.finishRound(onPhone.id!, 0)
    await phone.sync()

    await mac.sync()
    expect((await mac.db.lessons.get(id))!.progress.roundsDone).toBe(1)
    await phone.store.deleteLesson(onPhone.id!)
    await phone.sync()
    await mac.sync()
    expect(await mac.db.lessons.count()).toBe(0)
    expect(await mac.db.cards.count()).toBe(0)
  })
})

describe('private lessons (a textbook of the learner’s own)', () => {
  it('never leave the device by sync, even brought to a synced one by a backup', async () => {
    const env = await server()
    const web = await device(env, 'web', BACKENDS[0])
    const other = await device(env, 'other', sqliteBackend)
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
    const id = await web.store.createLesson({ title: 'Test book L1', uid: 'private:Test book L1', sentences: [{ start: 0, end: 1, text: 'はい。' }], media: { blob: audio, name: 'L1.mp3' } })
    await web.store.addCard({ uid: 'private:Test book L1|はい', lessonId: id, kind: 'word', front: 'はい', reading: 'はい', context: '', gloss: 'yes' })
    await web.store.log({ lessonId: id, step: 'intensive', mode: 'input', ms: 60_000, at: Date.now() })
    await web.store.createLesson({ title: 'shared', sentences: [{ start: null, end: null, text: 'いいえ。' }] })
    await web.sync()
    await web.store.deleteLesson(id)
    await web.sync()

    await other.sync()
    expect((await other.db.lessons.all()).map((l) => l.title)).toEqual(['shared'])
    expect(await other.db.cards.count()).toBe(0)
    expect(await other.db.media.count()).toBe(0)
    expect(await other.db.logs.count()).toBe(0)
    expect((await other.db.deletions.all()).filter((d) => d.uid.startsWith('private:'))).toEqual([])
  })
})

describe('suspended cards between a Mac (SQLite) and a phone (IndexedDB)', () => {
  it('carries a suspension across, and back when resumed, with edits', async () => {
    const env = await server()
    const mac = await device(env, 'mac', sqliteBackend)
    const phone = await device(env, 'phone', BACKENDS[0])
    const id = await mac.store.createLesson({ title: '散歩', sentences: [{ start: null, end: null, text: 'おはよう。' }] })
    const card = await mac.store.addCard({ lessonId: id, kind: 'word', front: '散歩', reading: 'さんぽ', context: 'おはよう。' })
    await mac.store.setSuspended(card, true)
    await mac.store.editCard(card, { reading: 'さんぽ（する）' })
    await mac.sync()

    await phone.sync()
    const [onPhone] = await phone.db.cards.all()
    expect([onPhone.suspendedAt, onPhone.reading]).toEqual([(await mac.db.cards.get(card))!.suspendedAt, 'さんぽ（する）'])
    expect(onPhone.suspendedAt).toBeGreaterThan(0)
    expect(await phone.store.dueCards()).toEqual([])

    await phone.store.setSuspended(onPhone.id!, false)
    await phone.sync()
    await mac.sync()
    expect((await mac.db.cards.get(card))!.suspendedAt).toBeUndefined()
    expect((await mac.store.dueCards()).map((c) => c.front)).toEqual(['散歩'])
  })
})

describe('core words between a Mac (SQLite) and a phone (IndexedDB)', () => {
  it('carries a reviewed core card, which belongs to no lesson, across', async () => {
    const env = await server()
    const mac = await device(env, 'mac', sqliteBackend)
    const phone = await device(env, 'phone', BACKENDS[0])
    await introduceCoreWords(mac.db, 3)
    const [first] = await mac.store.dueCards()
    await mac.store.gradeCard(first.id!, Rating.Good)
    await mac.sync()
    await phone.sync()
    const cards = await phone.db.cards.all()
    expect(cards.map((c) => [c.uid, c.lessonId])).toEqual([[first.uid, 0]]) // only the reviewed one has synced
    expect(cards[0].card.due.getTime()).toBe((await mac.db.cards.get(first.id!))!.card.due.getTime())
  })

  it('keeps a core word deleted on one device deleted when the other introduces it', async () => {
    const env = await server()
    const mac = await device(env, 'mac', sqliteBackend)
    const phone = await device(env, 'phone', BACKENDS[0])
    await introduceCoreWords(mac.db, 1)
    const [card] = await mac.db.cards.all()
    await mac.store.gradeCard(card.id!, Rating.Good) // reviewed, so it syncs
    await mac.sync()
    await phone.sync()
    await phone.store.removeCard((await phone.db.cards.all())[0].id!)
    await phone.sync()
    await mac.sync()
    expect(await mac.db.cards.count()).toBe(0)
    // A third device starting today introduces the same word fresh; the deletion still wins.
    const laptop = await device(env, 'laptop', sqliteBackend)
    await introduceCoreWords(laptop.db, 1)
    expect((await laptop.db.cards.all())[0].uid).toBe(coreUid(CORE_WORDS[0][0]))
    await laptop.sync()
    expect(await laptop.db.cards.where('uid', [coreUid(CORE_WORDS[0][0])])).toEqual([])
    // ...and doesn't come back on the next introduction (or the day's count would let it).
    await introduceCoreWords(laptop.db, 1)
    expect((await laptop.db.cards.all()).map((c) => c.uid)).toEqual([coreUid(CORE_WORDS[1][0])])
  })
})
