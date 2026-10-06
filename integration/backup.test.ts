// A backup from the web app (IndexedDB) restores on the Mac (SQLite), and back: the way a
// library moves between them. Lives outside the typecheck projects, like sync.test.ts.
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { exportBackup, parseBackup, restoreBackup } from '@kikitori/core/backup'
import type { Database } from '@kikitori/core/database'
import { Rating } from '@kikitori/core/srs'
import { createStore } from '@kikitori/core/store'
import { sqliteDatabase, type SqlDriver } from '@kikitori/sqlite'
import { dexieBackend } from '../src/test/dexieBackend'

const dexie = dexieBackend()
afterEach(() => dexie.cleanup())
const sqlite = () => sqliteDatabase(new DatabaseSync(':memory:') as unknown as SqlDriver)
const AUDIO = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253])

/** A small library: a lesson with audio, a graded card, a practice log and known words. */
async function fill(db: Database) {
  const store = createStore(db)
  const id = await store.createLesson({
    title: '散歩',
    level: 'N4',
    sentences: [{ start: 0.6, end: 2, text: 'おはようございます。', translations: { en: 'Good morning.' } }],
    media: { blob: new Blob([AUDIO], { type: 'audio/mp4' }), name: 'walk.m4a' },
  })
  await store.finishRound(id, 0)
  await store.setHard(id, 0, true)
  const card = await store.addCard({ lessonId: id, kind: 'word', front: '散歩', reading: 'さんぽ', context: 'おはようございます。' })
  await store.gradeCard(card, Rating.Good)
  await store.log({ lessonId: id, step: 'shadowing', mode: 'output', ms: 30_000, at: Date.now() })
  await store.addKnownWords(['散歩', '朝'])
}

async function check(db: Database) {
  const [lesson] = await db.lessons.all()
  expect(lesson).toMatchObject({ title: '散歩', level: 'N4', hard: [0], progress: { roundsDone: 1 } })
  expect(lesson.sentences[0]).toMatchObject({ start: 0.6, end: 2, translations: { en: 'Good morning.' } })
  // The lesson's audio link resolves, with the bytes and type intact.
  const media = (await db.media.get(lesson.mediaId!))!
  expect(media.uid).toBe(lesson.mediaUid)
  expect([media.name, media.blob.type]).toEqual(['walk.m4a', 'audio/mp4'])
  expect([...new Uint8Array(await media.blob.arrayBuffer())]).toEqual([...AUDIO])
  const [card] = await db.cards.all()
  expect(card.lessonId).toBe(lesson.id)
  expect(card.card.due).toBeInstanceOf(Date)
  expect(card.card.last_review).toBeInstanceOf(Date)
  expect(card.card.due.getTime()).toBeGreaterThan(Date.now())
  expect((await db.logs.all()).map((l) => [l.lessonUid, l.ms])).toEqual([[lesson.uid, 30_000]])
  expect((await db.words.all()).map((w) => w.lemma).sort()).toEqual(['散歩', '朝'].sort())
  // Cards come due on the right day in the destination too.
  expect(await createStore(db).dueCards(card.card.due.getTime())).toHaveLength(1)
}

describe('backups between the web app and the Mac', () => {
  it.each([
    ['web (IndexedDB) → Mac (SQLite)', () => dexie.open(), sqlite],
    ['Mac (SQLite) → web (IndexedDB)', sqlite, () => dexie.open()],
  ])('%s', async (_name, from, to) => {
    const source = from()
    await fill(source)
    await check(source)
    const json = await (await exportBackup(source, { lang: 'zh', voiceURI: 'web-only' })).text()
    const destination = to()
    await createStore(destination).createLesson({ title: 'replaced', sentences: [] })
    const backup = parseBackup(json)
    expect(backup.settings).toEqual({ lang: 'zh', voiceURI: 'web-only' })
    await restoreBackup(destination, backup)
    await check(destination)
  })
})
