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

    const json = JSON.stringify(await exportBackup(src.db, { lang: 'zh' }, T0))
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
})
