import { DatabaseSync } from 'node:sqlite'
import type { Backend } from '@kikitori/core/test/contracts/backend'
import { backupContract } from '@kikitori/core/test/contracts/backup'
import { databaseContract } from '@kikitori/core/test/contracts/database'
import { seedContract } from '@kikitori/core/test/contracts/seed'
import { storeContract } from '@kikitori/core/test/contracts/store'
import { describe, expect, it } from 'vitest'
import { sqliteDatabase, type SqlDriver } from './sqliteDatabase'

// The same contracts the web app's Dexie storage runs, on node:sqlite (the macOS app uses
// bun:sqlite, whose API is the same).
const sqlite: Backend = {
  name: 'SQLite',
  open: () => sqliteDatabase(new DatabaseSync(':memory:') as unknown as SqlDriver),
  cleanup: async () => {},
}

databaseContract(sqlite)
storeContract(sqlite)
seedContract(sqlite)
backupContract(sqlite)

describe('SQLite storage', () => {
  it('keeps its data across reopening the file, and refuses a newer schema', () => {
    const file = new DatabaseSync(':memory:')
    const db = sqliteDatabase(file as unknown as SqlDriver)
    return db.lessons
      .add({ title: 'a', sentences: [], progress: { roundsDone: 0, lastCompletedAt: null }, resume: null, hard: [], createdAt: 1 })
      .then(async (id) => {
        const again = sqliteDatabase(file as unknown as SqlDriver)
        expect((await again.lessons.get(id))!.title).toBe('a')
        file.exec('PRAGMA user_version = 99')
        expect(() => sqliteDatabase(file as unknown as SqlDriver)).toThrow('newer than this app')
      })
  })

  it('runs transactions one at a time, and rolls back a failed one', async () => {
    const db = sqliteDatabase(new DatabaseSync(':memory:') as unknown as SqlDriver)
    const order: string[] = []
    const slow = db.transaction(async () => {
      order.push('a start')
      await db.words.add({ lemma: '雨', firstSeen: 1 })
      await new Promise((r) => setTimeout(r, 20))
      order.push('a end')
    })
    const fast = db.transaction(async () => {
      order.push('b')
      expect(await db.words.count()).toBe(1) // a has committed
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['a start', 'a end', 'b'])
    await expect(
      db.transaction(async () => {
        await db.words.add({ lemma: '風', firstSeen: 2 })
        throw new Error('no')
      }),
    ).rejects.toThrow('no')
    expect((await db.words.all()).map((w) => w.lemma)).toEqual(['雨'])
  })

  it('runs calls in the order they were made', async () => {
    const db = sqliteDatabase(new DatabaseSync(':memory:') as unknown as SqlDriver)
    const added = db.words.add({ lemma: '雨', firstSeen: 1 })
    const counted = db.words.count() // not awaited between: still sees the add
    await added
    expect(await counted).toBe(1)
  })
})
