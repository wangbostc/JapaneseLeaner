import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addPrivateLessons, forgetPrivateLessons, type ReadAudio } from '../../src/privateLessons'
import type { KeyValueStore } from '../../src/seed'
import { createStore, type Store } from '../../src/store'
import type { Backend } from './backend'

const T0 = Date.UTC(2026, 0, 10, 9)

function memoryPrefs(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

/** Audio "files": a path maps to bytes (the stamp changes with them); `locked` ones can be
 *  stat'ed but not read (as macOS privacy refuses), so read gives null, as the real one does. */
function files(initial: Record<string, string> = {}) {
  const fs = new Map(Object.entries(initial))
  const locked = new Set<string>()
  const reads: string[] = []
  const audio: ReadAudio = {
    stamp: async (path) => fs.get(path) ?? null,
    read: async (path) => {
      reads.push(path)
      if (locked.has(path)) return null
      const bytes = fs.get(path)
      return bytes === undefined ? null : { blob: new Blob([bytes], { type: 'audio/mpeg' }), name: path.split('/').at(-1)! }
    },
  }
  return { fs, locked, reads, audio }
}

// Invented text: the repo is public, and a real textbook's must never be in it.
const chapter = {
  title: 'Test book L3 会話',
  book: 'Test book',
  chapter: 3,
  audio: '/book/L3.mp3',
  lines: [
    { ja: '駅はどこですか。', en: 'Where is the station?', start: 0.5, end: 2.5 },
    { ja: 'あそこです。', en: 'Over there.', zh: '在那边。', start: 2.8, end: 4.1 },
  ],
  vocab: [
    { word: '駅', reading: 'えき', en: 'station' },
    { word: 'あそこ', en: 'over there' },
  ],
}

/** Private lessons from the local MongoDB, which every storage backend must reproduce. */
export function privateLessonsContract(backend: Backend) {
  let s: Store
  beforeEach(() => {
    s = createStore(backend.open())
  })
  afterEach(() => backend.cleanup())

  const byUid = async (uid: string) => (await s.db.lessons.where('uid', [uid]))[0]

  describe(`private lessons (${backend.name})`, () => {
    it('adds a chapter as a labelled lesson with its timed audio and its words as cards, once', async () => {
      const prefs = memoryPrefs()
      const { audio, reads } = files({ '/book/L3.mp3': 'abc' })
      expect(await addPrivateLessons(s, [chapter], audio, prefs, T0)).toEqual({ added: 1, updated: 0, cards: 2, problems: [] })
      const l = (await byUid('private:Test book L3 会話'))!
      expect(l).toMatchObject({ title: 'Test book L3 会話', level: 'Test book · L3' })
      expect(l.sentences).toEqual([
        { text: '駅はどこですか。', start: 0.5, end: 2.5, translations: { en: 'Where is the station?' } },
        { text: 'あそこです。', start: 2.8, end: 4.1, translations: { en: 'Over there.', zh: '在那边。' } },
      ])
      const media = (await s.db.media.get(l.mediaId!))!
      expect([media.name, await media.blob.text()]).toEqual(['L3.mp3', 'abc'])
      const cards = await s.db.cards.where('lessonId', [l.id!])
      expect(cards.map((c) => [c.front, c.reading, c.gloss])).toEqual([
        ['駅', 'えき', 'station'],
        ['あそこ', '', 'over there'],
      ])

      // Again, unchanged: nothing new, and its audio not even read.
      expect(await addPrivateLessons(s, [chapter], audio, prefs, T0)).toEqual({ added: 0, updated: 0, cards: 0, problems: [] })
      expect(reads).toEqual(['/book/L3.mp3'])
      expect(await s.db.lessons.count()).toBe(1)
      expect(await s.db.cards.count()).toBe(2)
    })

    it('reads a lesson aloud when its audio has no timings, or can’t be read, and carries on past it', async () => {
      const untimed = { ...chapter, title: 'L4', vocab: [], lines: [{ ja: 'あります。' }] }
      const missing = { ...chapter, title: 'L5', vocab: [], audio: '/book/none.mp3' }
      const locked = { ...chapter, title: 'L6', vocab: [], audio: '/book/locked.mp3' }
      const after = { ...chapter, title: 'L7', vocab: [] }
      const f = files({ '/book/locked.mp3': 'x', '/book/L3.mp3': 'abc' })
      f.locked.add('/book/locked.mp3')
      const prefs = memoryPrefs()
      const r = await addPrivateLessons(s, [untimed, missing, locked, after], f.audio, prefs, T0)
      expect(r.problems).toEqual([
        'L4: its audio needs a start and end on every line; read aloud for now',
        "L5: can't read /book/none.mp3; read aloud for now",
        "L6: can't read /book/locked.mp3; read aloud for now",
      ])
      expect(r.added).toBe(4)
      for (const uid of ['private:L4', 'private:L5', 'private:L6']) expect((await byUid(uid))!.mediaId).toBeUndefined()
      expect((await byUid('private:L7'))!.mediaId).toBeDefined() // the one after still came in

      // Allowed later (the file itself unchanged): its audio comes in at the next start.
      f.locked.delete('/book/locked.mp3')
      expect(await addPrivateLessons(s, [untimed, missing, locked, after], f.audio, prefs, T0)).toMatchObject({ updated: 1 })
      const l6 = (await byUid('private:L6'))!
      expect([await (await s.db.media.get(l6.mediaId!))!.blob.text(), l6.sentences[0].start]).toEqual(['x', 0.5])

      // Refused again after an edit: the audio it has stays, with its timings.
      f.locked.add('/book/locked.mp3')
      const edited = { ...locked, lines: [{ ...locked.lines[0], en: 'Where’s the station?' }, locked.lines[1]] }
      await addPrivateLessons(s, [untimed, missing, edited, after], f.audio, prefs, T0)
      const kept = (await byUid('private:L6'))!
      expect([kept.mediaId, kept.sentences[0].translations?.en, kept.sentences[0].start]).toEqual([l6.mediaId, 'Where’s the station?', 0.5])
    })

    it('updates a lesson changed in MongoDB, keeping its progress', async () => {
      const prefs = memoryPrefs()
      const { fs, audio } = files({ '/book/L3.mp3': 'abc' })
      await addPrivateLessons(s, [chapter], audio, prefs, T0)
      const l = (await byUid('private:Test book L3 会話'))!
      await s.finishRound(l.id!, 0, T0)
      await s.setHard(l.id!, 1, true)

      // A corrected translation and new audio: same lines, so the hard sentence stays marked.
      fs.set('/book/L3.mp3', 'abcd')
      const fixed = { ...chapter, lines: [chapter.lines[0], { ...chapter.lines[1], en: 'Over there, by the bank.' }] }
      expect(await addPrivateLessons(s, [fixed], audio, prefs, T0)).toMatchObject({ added: 0, updated: 1 })
      const after = (await byUid('private:Test book L3 会話'))!
      expect(after.sentences[1].translations?.en).toBe('Over there, by the bank.')
      expect(after.progress.roundsDone).toBe(1)
      expect(after.hard).toEqual([1])
      expect(await (await s.db.media.get(after.mediaId!))!.blob.text()).toBe('abcd')
      expect(await s.db.media.count()).toBe(1) // the old audio is gone

      // Lines added: the old places no longer mean what they did.
      expect(await addPrivateLessons(s, [{ ...fixed, lines: [...fixed.lines, { ja: 'どうも。', start: 5, end: 6 }] }], audio, prefs, T0)).toMatchObject({ updated: 1 })
      expect((await byUid('private:Test book L3 会話'))!.hard).toEqual([])

      // A word's meaning corrected: the card follows, keeping its schedule.
      const words = { ...fixed, vocab: [{ word: '駅', reading: 'えき', en: 'railway station' }, chapter.vocab[1]] }
      await addPrivateLessons(s, [words], audio, prefs, T0)
      expect((await s.db.cards.all()).find((c) => c.front === '駅')!.gloss).toBe('railway station')
      expect(await s.db.cards.count()).toBe(2)

      // A card corrected here keeps its correction while the document doesn't change.
      const station = (await s.db.cards.all()).find((c) => c.front === '駅')!
      await s.editCard(station.id!, { reading: 'エキ' })
      await addPrivateLessons(s, [words], audio, prefs, T0)
      expect((await s.db.cards.get(station.id!))!.reading).toBe('エキ')
    })

    it('compares every lesson again once told to forget (after restoring a backup)', async () => {
      const prefs = memoryPrefs()
      const { audio, reads } = files({ '/book/L3.mp3': 'abc' })
      await addPrivateLessons(s, [chapter], audio, prefs, T0)
      // A restored backup's older copy of the lesson.
      const l = (await byUid('private:Test book L3 会話'))!
      await s.db.lessons.update(l.id!, { sentences: [{ text: '古い。', start: null, end: null }] })
      forgetPrivateLessons(prefs)
      expect(await addPrivateLessons(s, [chapter], audio, prefs, T0)).toMatchObject({ updated: 1 })
      expect((await byUid('private:Test book L3 会話'))!.sentences[0].text).toBe('駅はどこですか。')
      expect(reads).toHaveLength(2)
    })

    it('keeps a deleted lesson or card deleted', async () => {
      const prefs = memoryPrefs()
      const { audio } = files({ '/book/L3.mp3': 'abc' })
      await addPrivateLessons(s, [chapter], audio, prefs, T0)
      const card = (await s.db.cards.all()).find((c) => c.front === '駅')!
      await s.removeCard(card.id!)
      await addPrivateLessons(s, [chapter], audio, prefs, T0)
      expect((await s.db.cards.all()).map((c) => c.front)).toEqual(['あそこ'])

      await s.deleteLesson((await byUid('private:Test book L3 会話'))!.id!)
      prefs.map.clear() // even with what it remembered gone
      expect(await addPrivateLessons(s, [chapter], audio, prefs, T0)).toMatchObject({ added: 0, cards: 0 })
      expect(await s.db.lessons.count()).toBe(0)
    })

    it('names what’s wrong with a document, and adds the rest', async () => {
      const r = await addPrivateLessons(
        s,
        [
          { title: '', lines: [] },
          { ...chapter, vocab: [{ word: '駅' }] },
          { title: 'ok', lines: [{ ja: 'はい。', en: { bad: 1 } }] },
          { title: 'twice', lines: [{ ja: 'はい。' }], vocab: [{ word: '二', reading: 'に', en: 'two' }, { word: '二', reading: 'ふた', en: 'two (prefix)' }] },
          { title: 'Dup', lines: [{ ja: 'はい。' }] },
          { title: 'Dup ', lines: [{ ja: 'いいえ。' }] },
        ],
        files().audio,
        memoryPrefs(),
        T0,
      )
      expect(r.added).toBe(1)
      expect(r.problems).toEqual([
        '#1: missing title; no lines',
        'Test book L3 会話: word 1 needs "word" and "en"',
        'ok: line 1: "en" must be text',
        'twice: word 2 (二) is listed twice',
        'Dup: duplicate title',
      ])
    })
  })
}
