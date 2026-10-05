import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../src/database'
import type { Lesson } from '../../src/model'
import type { Backend } from './backend'

// Later than the real clock: stamps never go backwards, so a T0 in the past would be overtaken.
const T0 = Date.UTC(2099, 8, 25, 9)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const lesson = (title: string, extra: Partial<Lesson> = {}): Lesson => ({
  title,
  sentences: [],
  progress: { roundsDone: 0, lastCompletedAt: null },
  resume: null,
  hard: [],
  createdAt: T0,
  ...extra,
})

/** The Database interface's own rules (identity stamping, sync-apply, ordering, transactions). */
export function databaseContract(backend: Backend) {
  let db: Database
  beforeEach(() => {
    db = backend.open()
  })
  afterEach(() => backend.cleanup())

  describe(`database (${backend.name})`, () => {
    it('gives new synced records a uid and updatedAt, and built-in lessons their shared uid', async () => {
      const mine = await db.lessons.add(lesson('mine'))
      const sample = await db.lessons.add(lesson('私の朝', { builtIn: true }))
      const kept = await db.lessons.add(lesson('kept', { uid: 'given', updatedAt: 5 }))
      expect((await db.lessons.get(mine))!.uid).toMatch(UUID)
      expect((await db.lessons.get(mine))!.updatedAt).toBeGreaterThan(0)
      expect((await db.lessons.get(sample))!.uid).toBe('sample:私の朝')
      expect(await db.lessons.get(kept)).toMatchObject({ uid: 'given', updatedAt: 5 })
    })

    it('stamps an edit as newer, except device-local fields and sync-applied writes', async () => {
      const id = await db.lessons.add(lesson('a', { updatedAt: T0 }))
      await db.lessons.update(id, { mediaId: 7 })
      expect((await db.lessons.get(id))!.updatedAt).toBe(T0) // which audio row: local only
      await db.lessons.update(id, { hard: [1] })
      expect((await db.lessons.get(id))!.updatedAt).toBe(T0 + 1) // later than the version it replaces
      await db.transaction(() => db.lessons.update(id, { hard: [2] }), { syncApply: true })
      expect((await db.lessons.get(id))!.updatedAt).toBe(T0 + 1)
      await db.lessons.update(id, { title: 'b', updatedAt: 3 })
      expect((await db.lessons.get(id))!.updatedAt).toBe(3) // an explicit updatedAt wins
    })

    it('lets a nested transaction join the outer one and keep its sync-apply mode', async () => {
      const id = await db.lessons.add(lesson('a', { updatedAt: T0 }))
      await db.transaction(async () => {
        await db.transaction(() => db.lessons.update(id, { hard: [1] }))
      }, { syncApply: true })
      expect((await db.lessons.get(id))!.updatedAt).toBe(T0)
      await expect(
        db.transaction(async () => {
          await db.lessons.update(id, { hard: [9] })
          throw new Error('abort')
        }),
      ).rejects.toThrow('abort')
      expect((await db.lessons.get(id))!.hard).toEqual([1]) // rolled back
    })

    it('finds rows by any field in key order, and by change time', async () => {
      const a = await db.lessons.add(lesson('a', { mediaUid: 'm', updatedAt: 10 }))
      const b = await db.lessons.add(lesson('b', { updatedAt: 20 }))
      const c = await db.lessons.add(lesson('c', { mediaUid: 'm', updatedAt: 30 }))
      const uids = (await db.lessons.all()).map((l) => l.uid!)
      expect((await db.lessons.where('uid', [uids[2], uids[0]])).map((l) => l.id)).toEqual([a, c])
      expect((await db.lessons.where('mediaUid', ['m'])).map((l) => l.id)).toEqual([a, c]) // not an index
      expect(await db.lessons.where('uid', [])).toEqual([])
      expect((await db.lessons.changedSince(15)).map((l) => l.id)).toEqual([b, c])
      await db.lessons.delete([a, b])
      expect((await db.lessons.all()).map((l) => l.id)).toEqual([c])
    })

    it('keeps ids, replaces with put, and finds due cards', async () => {
      await db.lessons.bulkAdd([lesson('kept id', { id: 41 })])
      expect((await db.lessons.get(41))!.title).toBe('kept id')
      await db.lessons.put({ ...(await db.lessons.get(41))!, title: 'replaced' })
      expect(await db.lessons.count()).toBe(1)
      expect((await db.lessons.get(41))!.title).toBe('replaced')
      await db.lessons.update(999, { title: 'nobody' }) // no row: nothing happens

      const card = (front: string, due: number) => ({ lessonId: 41, kind: 'word' as const, front, reading: front, context: front, createdAt: T0, card: { due: new Date(due) } as never })
      await db.cards.bulkAdd([card('now', T0), card('later', T0 + 1000)])
      expect((await db.cards.dueBy(new Date(T0))).map((c) => c.front)).toEqual(['now'])
      expect((await db.cards.get((await db.cards.all())[0].id!))!.card.due).toBeInstanceOf(Date)

      await db.words.add({ lemma: '雨', firstSeen: T0 })
      await db.words.put({ lemma: '雨', firstSeen: T0 - 1 })
      expect(await db.words.get('雨')).toEqual({ lemma: '雨', firstSeen: T0 - 1 })
      await db.words.clear()
      expect(await db.words.count()).toBe(0)
    })
  })
}
