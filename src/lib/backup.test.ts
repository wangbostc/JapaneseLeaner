import { afterEach, describe, expect, it } from 'vitest'
import { BackupError, exportBackup, parseBackup, restoreBackup } from './backup'
import { KikitoriDB } from './db'
import { Rating } from './srs'
import { createStore } from './store'

const T0 = Date.UTC(2026, 0, 10, 9)
const dbs: KikitoriDB[] = []
const fresh = (name: string) => {
  const d = new KikitoriDB(`backup-${name}-${dbs.length}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()))
})

describe('backup', () => {
  it('keeps sync identity through a round trip, and marks restored data as newest', async () => {
    const src = createStore(fresh('uid-src'))
    const id = await src.createLesson({ title: 't', sentences: [], media: { blob: new Blob(['x'], { type: 'audio/wav' }), name: 'a.wav' } }, T0)
    const cardId = await src.addCard({ lessonId: id, kind: 'word', front: '雨', reading: 'あめ', context: '雨' }, T0)
    await src.removeCard(cardId, T0 + 1)
    const [lesson] = await src.db.lessons.toArray()
    const [media] = await src.db.media.toArray()

    const dst = fresh('uid-dst')
    const restoredAt = T0 + 1000
    await restoreBackup(dst, parseBackup(await (await exportBackup(src.db, undefined, T0)).text()), restoredAt)
    const [l] = await dst.lessons.toArray()
    expect(l.uid).toBe(lesson.uid)
    expect(l.updatedAt).toBe(restoredAt)
    expect((await dst.media.toArray())[0].uid).toBe(media.uid)
    expect((await dst.deletions.toArray()).map((d) => d.table)).toEqual(['cards'])
  })

  it('restores a v1 backup, assigning uids', async () => {
    const v1 = JSON.stringify({
      format: 'kikitori-backup',
      version: 1,
      exportedAt: T0,
      lessons: [{ id: 1, title: 'old', sentences: [{ text: 'はい。' }], hard: [], progress: { roundsDone: 2, lastCompletedAt: T0 }, resume: null, createdAt: T0 }],
      media: [],
      cards: [{ id: 1, lessonId: 1, kind: 'word', front: 'はい', reading: 'はい', context: 'はい。', card: { due: new Date(T0).toISOString() } }],
      logs: [],
      words: [],
    })
    const dst = fresh('v1')
    await restoreBackup(dst, parseBackup(v1), T0 + 5)
    const [l] = await dst.lessons.toArray()
    expect(l.uid).toMatch(/^[0-9a-f-]{36}$/)
    expect(l).toMatchObject({ title: 'old', progress: { roundsDone: 2 }, updatedAt: T0 + 5 })
    expect((await dst.cards.toArray())[0].uid).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('round-trips lessons, audio, cards, logs and words through JSON', async () => {
    const src = createStore(fresh('src'))
    const audio = new Blob([new Uint8Array([0, 1, 2, 250, 255])], { type: 'audio/wav' })
    const id = await src.createLesson(
      { title: '散歩', sentences: [{ start: 0.5, end: 1.5, text: 'おはよう。' }], media: { blob: audio, name: 'clip.wav' } },
      T0,
    )
    await src.setHard(id, 0, true)
    await src.finishRound(id, 0, T0)
    const card = await src.addCard({ lessonId: id, kind: 'word', front: '散歩', reading: 'さんぽ', context: '散歩する。' }, T0)
    await src.gradeCard(card, Rating.Good, T0)
    await src.log({ lessonId: id, step: 'intensive', mode: 'input', ms: 60_000, at: T0 })
    await src.addKnownWords(['散歩'], T0)

    const json = await (await exportBackup(src.db, { lang: 'zh' }, T0)).text()
    const dstDb = fresh('dst')
    const dst = createStore(dstDb)
    await dst.createLesson({ title: 'will be replaced', sentences: [] }, T0)
    const parsed = parseBackup(json)
    expect(parsed.settings).toEqual({ lang: 'zh' })
    await restoreBackup(dstDb, parsed)

    const lessons = await dstDb.lessons.toArray()
    expect(lessons.map((l) => l.title)).toEqual(['散歩'])
    expect(lessons[0]).toMatchObject({ hard: [0], progress: { roundsDone: 1, lastCompletedAt: T0 } })
    const media = await dstDb.media.get(lessons[0].mediaId!)
    expect(media!.blob.type).toBe('audio/wav')
    expect([...new Uint8Array(await media!.blob.arrayBuffer())]).toEqual([0, 1, 2, 250, 255])

    // Card dates come back as Dates, so the due index still answers queries.
    const [c] = await dstDb.cards.toArray()
    expect(c.card.due).toBeInstanceOf(Date)
    expect(c.card.last_review).toBeInstanceOf(Date)
    expect(await dst.dueCards(T0)).toEqual([])
    expect((await dst.dueCards(c.card.due.getTime())).map((x) => x.front)).toEqual(['散歩'])

    expect(await dst.stats(T0)).toMatchObject({ totalMs: 60_000, words: 1, cards: 1 })
  })

  it('rejects files that are not Kikitori backups', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError)
    expect(() => parseBackup('{"format":"other"}')).toThrow('not a Kikitori backup')
    expect(() => parseBackup('{"format":"kikitori-backup","version":99}')).toThrow('unsupported backup version 99')
    expect(() => parseBackup('{"format":"kikitori-backup","version":1,"lessons":[]}')).toThrow('backup is missing media')
  })

  it('rejects malformed lessons, cards and audio before touching the database', () => {
    const base = { format: 'kikitori-backup', version: 1, lessons: [], media: [], cards: [], logs: [], words: [] }
    const bad = (patch: object) => JSON.stringify({ ...base, ...patch })
    expect(() => parseBackup(bad({ lessons: [{ title: 'x', sentences: [], hard: [] }] }))).toThrow('lesson 1 is malformed')
    expect(() => parseBackup(bad({ cards: [{ front: 'x', card: { due: 'not a date' } }] }))).toThrow('card 1 is malformed')
    expect(() => parseBackup(bad({ media: [{ id: '1', base64: '' }] }))).toThrow('audio 1 is malformed')
    expect(parseBackup(bad({})).lessons).toEqual([])
  })

  it('exports an empty database as valid JSON', async () => {
    const empty = fresh('empty')
    expect(parseBackup(await (await exportBackup(empty, undefined, T0)).text()).media).toEqual([])
  })
})
