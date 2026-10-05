import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleLessons } from '@kikitori/core/samples'
import { sampleUid } from '@kikitori/core/model'
import { KikitoriDB } from './db'
import { seedOnce } from './seed'
import { createStore, type Store } from './store'

const ALL = sampleLessons().map((l) => sampleUid(l.title))
const OLD = ['私の朝', '週末のカフェ', '雨の日の過ごし方'].map(sampleUid)
let s: Store
let n = 0

beforeEach(() => {
  s = createStore(new KikitoriDB(`seed-test-${n++}`))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await s.db.delete()
})

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  })
  return m
}

const uids = async () => (await s.db.lessons.toArray()).map((l) => l.uid).sort()
const byUid = (uid: string) => s.db.lessons.where('uid').equals(uid).first()

describe('seedOnce', () => {
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
    expect(await s.db.lessons.where('uid').equals(synced).count()).toBe(1)
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
    expect(new Set((await s.db.lessons.toArray()).map((l) => l.updatedAt))).toEqual(new Set([0]))
  })
})
