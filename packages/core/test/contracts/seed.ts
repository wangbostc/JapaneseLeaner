import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleUid } from '../../src/model'
import { sampleLessons } from '../../src/samples'
import { seedOnce } from '../../src/seed'
import { createStore, type Store } from '../../src/store'
import type { Backend } from './backend'

const ALL = sampleLessons().map((l) => sampleUid(l.title))
const OLD = ['私の朝', '週末のカフェ', '雨の日の過ごし方'].map(sampleUid)

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  })
  return m
}

/** Seeding the starter lessons, which every storage backend must reproduce. */
export function seedContract(backend: Backend) {
  let s: Store
  beforeEach(() => {
    s = createStore(backend.open())
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await backend.cleanup()
  })

  const uids = async () => (await s.db.lessons.all()).map((l) => l.uid).sort()
  const byUid = async (uid: string) => (await s.db.lessons.where('uid', [uid]))[0]

  describe(`seedOnce (${backend.name})`, () => {
  it('covers every level from N5 to N1, with unique titles', () => {
    expect(new Set(sampleLessons().map((l) => l.level))).toEqual(new Set(['N5', 'N4', 'N3', 'N2', 'N1']))
    expect(new Set(ALL).size).toBe(ALL.length)
    expect(ALL).toEqual(expect.arrayContaining(OLD))
  })

  it('brings the samples a later release adds to an existing install, but not the ones it already had', async () => {
    const storage = memoryStorage({ 'kikitori.seeded': '1' })
    // The learner kept 私の朝 and deleted the other two before deletions were recorded.
    await s.createLesson({ title: '私の朝', sentences: [], builtIn: true, uid: sampleUid('私の朝'), updatedAt: 0 })
    await seedOnce(s)
    expect(await uids()).toEqual(ALL.filter((u) => !OLD.includes(u) || u === sampleUid('私の朝')).sort())
    expect(JSON.parse(storage.get('kikitori.seededSamples')!).sort()).toEqual([...ALL].sort())
  })

  it('adds each sample once, so a deleted one stays deleted', async () => {
    memoryStorage()
    await seedOnce(s)
    expect(await uids()).toEqual([...ALL].sort())
    await s.deleteLesson((await byUid(ALL[1]))!.id!)
    await s.db.deletions.clear() // even with its tombstone gone
    await seedOnce(s)
    expect(await uids()).toEqual(ALL.filter((u) => u !== ALL[1]).sort())
  })

  it('without localStorage, a deleted sample stays deleted by its tombstone', async () => {
    vi.stubGlobal('localStorage', undefined)
    await seedOnce(s)
    await s.deleteLesson((await byUid(ALL[0]))!.id!)
    await seedOnce(s)
    expect(await uids()).toEqual(ALL.slice(1).sort())
  })

  it('leaves a sample that already arrived by sync as it is', async () => {
    memoryStorage({ 'kikitori.seeded': '1' })
    const synced = ALL.find((u) => !OLD.includes(u))!
    const id = await s.createLesson({ title: synced.slice('sample:'.length), sentences: [], builtIn: true, uid: synced, updatedAt: 5 })
    await s.db.lessons.update(id, { progress: { roundsDone: 2, lastCompletedAt: 5 } })
    await seedOnce(s)
    expect((await s.db.lessons.where('uid', [synced])).length).toBe(1)
    expect((await byUid(synced))!.progress.roundsDone).toBe(2)
  })

  it('adds nothing twice when called twice at once, with or without localStorage', async () => {
    memoryStorage()
    await Promise.all([seedOnce(s), seedOnce(s)])
    expect(await uids()).toEqual([...ALL].sort())

    await s.db.lessons.clear()
    vi.stubGlobal('localStorage', undefined)
    await Promise.all([seedOnce(s), seedOnce(s)])
    expect(await uids()).toEqual([...ALL].sort())
  })

  it('seeds samples as the oldest possible version, so a deletion from another device wins', async () => {
    memoryStorage()
    await seedOnce(s)
    expect(new Set((await s.db.lessons.all()).map((l) => l.updatedAt))).toEqual(new Set([0]))
  })

  it('records nothing until the samples are in, so a page closed meanwhile seeds them next time', async () => {
    const storage = memoryStorage()
    // A write that never commits: the page is closed (or reloaded) before it does.
    const closing = { ...s, db: { ...s.db, transaction: () => new Promise<never>(() => {}) } }
    void seedOnce(closing)
    await new Promise((r) => setTimeout(r, 20))
    expect(storage.get('kikitori.seededSamples')).toBeUndefined()
    await seedOnce(s) // the next start
    expect(await uids()).toEqual([...ALL].sort())
    expect(JSON.parse(storage.get('kikitori.seededSamples')!).sort()).toEqual([...ALL].sort())
  })

  it('lets the next start try again when adding the samples fails', async () => {
    const storage = memoryStorage()
    const failing = { ...s, db: { ...s.db, transaction: async () => Promise.reject(new Error('quota')) } }
    await expect(seedOnce(failing)).rejects.toThrow('quota')
    expect(JSON.parse(storage.get('kikitori.seededSamples') ?? '[]')).toEqual([])
    await seedOnce(s)
    expect(await uids()).toEqual([...ALL].sort())
  })
})
}
