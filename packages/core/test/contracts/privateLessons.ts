import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addPrivateLessons, type ReadAudio } from '../../src/privateLessons'
import type { KeyValueStore } from '../../src/seed'
import { createStore, type Store } from '../../src/store'
import type { Backend } from './backend'

const T0 = Date.UTC(2026, 0, 10, 9)

function memoryPrefs(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

/** Audio "files": a path maps to bytes; the stamp changes with them. */
function files(initial: Record<string, string> = {}) {
  const fs = new Map(Object.entries(initial))
  const read: ReadAudio = async (path) => {
    const bytes = fs.get(path)
    return bytes === undefined ? null : { blob: new Blob([bytes], { type: 'audio/mpeg' }), name: path.split('/').at(-1)!, stamp: bytes }
  }
  return { fs, read }
}

const lesson3 = {
  title: 'Genki I L3 会話',
  book: 'Genki I',
  chapter: 3,
  audio: '/genki/L3.mp3',
  lines: [
    { ja: '週末はたいてい何をしますか。', en: 'What do you usually do on weekends?', start: 0.5, end: 2.5 },
    { ja: 'テニスをします。', en: 'I play tennis.', zh: '我打网球。', start: 2.8, end: 4.1 },
  ],
  vocab: [
    { word: '朝', reading: 'あさ', en: 'morning' },
    { word: '週末', reading: 'しゅうまつ', en: 'weekend' },
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
      const { read } = files({ '/genki/L3.mp3': 'abc' })
      expect(await addPrivateLessons(s, [lesson3], read, prefs, T0)).toEqual({ added: 1, updated: 0, cards: 2, problems: [] })
      const l = (await byUid('private:Genki I L3 会話'))!
      expect(l).toMatchObject({ title: 'Genki I L3 会話', level: 'Genki I · L3' })
      expect(l.sentences).toEqual([
        { text: '週末はたいてい何をしますか。', start: 0.5, end: 2.5, translations: { en: 'What do you usually do on weekends?' } },
        { text: 'テニスをします。', start: 2.8, end: 4.1, translations: { en: 'I play tennis.', zh: '我打网球。' } },
      ])
      const media = (await s.db.media.get(l.mediaId!))!
      expect([media.name, await media.blob.text()]).toEqual(['L3.mp3', 'abc'])
      const cards = await s.db.cards.where('lessonId', [l.id!])
      expect(cards.map((c) => [c.front, c.reading, c.gloss])).toEqual([
        ['朝', 'あさ', 'morning'],
        ['週末', 'しゅうまつ', 'weekend'],
      ])

      // Again, unchanged: nothing new.
      expect(await addPrivateLessons(s, [lesson3], read, prefs, T0)).toEqual({ added: 0, updated: 0, cards: 0, problems: [] })
      expect(await s.db.lessons.count()).toBe(1)
      expect(await s.db.cards.count()).toBe(2)
    })

    it('reads a lesson aloud when its audio has no timings, or can’t be read', async () => {
      const untimed = { ...lesson3, title: 'L4', vocab: [], lines: [{ ja: 'あります。' }] }
      const missing = { ...lesson3, title: 'L5', vocab: [], audio: '/genki/none.mp3' }
      const r = await addPrivateLessons(s, [untimed, missing], files().read, memoryPrefs(), T0)
      expect(r.added).toBe(2)
      expect(r.problems).toEqual([
        'L4: its audio needs a start and end on every line; read aloud for now',
        "L5: can't read /genki/none.mp3; read aloud for now",
      ])
      for (const uid of ['private:L4', 'private:L5']) {
        const l = (await byUid(uid))!
        expect(l.mediaId).toBeUndefined()
        expect(l.sentences.every((x) => x.start === null && x.end === null)).toBe(true)
      }
    })

    it('updates a lesson changed in MongoDB, keeping its progress', async () => {
      const prefs = memoryPrefs()
      const { fs, read } = files({ '/genki/L3.mp3': 'abc' })
      await addPrivateLessons(s, [lesson3], read, prefs, T0)
      const l = (await byUid('private:Genki I L3 会話'))!
      await s.finishRound(l.id!, 0, T0)
      await s.setHard(l.id!, 1, true)

      // A corrected translation and new audio: same lines, so the hard sentence stays marked.
      fs.set('/genki/L3.mp3', 'abcd')
      const fixed = { ...lesson3, lines: [lesson3.lines[0], { ...lesson3.lines[1], en: 'I play tennis, usually.' }] }
      expect(await addPrivateLessons(s, [fixed], read, prefs, T0)).toMatchObject({ added: 0, updated: 1 })
      const after = (await byUid('private:Genki I L3 会話'))!
      expect(after.sentences[1].translations?.en).toBe('I play tennis, usually.')
      expect(after.progress.roundsDone).toBe(1)
      expect(after.hard).toEqual([1])
      expect(await (await s.db.media.get(after.mediaId!))!.blob.text()).toBe('abcd')
      expect(await s.db.media.count()).toBe(1) // the old audio is gone

      // Fewer lines: places past the end don't survive.
      expect(await addPrivateLessons(s, [{ ...fixed, lines: [lesson3.lines[0]] }], read, prefs, T0)).toMatchObject({ updated: 1 })
      expect((await byUid('private:Genki I L3 会話'))!.hard).toEqual([])

      // A word's meaning corrected: the card follows, keeping its schedule.
      const words = { ...fixed, vocab: [{ word: '朝', reading: 'あさ', en: 'morning; dawn' }, lesson3.vocab[1]] }
      await addPrivateLessons(s, [words], read, prefs, T0)
      expect((await s.db.cards.all()).find((c) => c.front === '朝')!.gloss).toBe('morning; dawn')
      expect(await s.db.cards.count()).toBe(2)
    })

    it('keeps a deleted lesson or card deleted', async () => {
      const prefs = memoryPrefs()
      const { read } = files({ '/genki/L3.mp3': 'abc' })
      await addPrivateLessons(s, [lesson3], read, prefs, T0)
      const card = (await s.db.cards.all()).find((c) => c.front === '朝')!
      await s.removeCard(card.id!)
      await addPrivateLessons(s, [lesson3], read, prefs, T0)
      expect((await s.db.cards.all()).map((c) => c.front)).toEqual(['週末'])

      await s.deleteLesson((await byUid('private:Genki I L3 会話'))!.id!)
      prefs.map.clear() // even with what it remembered gone
      expect(await addPrivateLessons(s, [lesson3], read, prefs, T0)).toMatchObject({ added: 0, cards: 0 })
      expect(await s.db.lessons.count()).toBe(0)
    })

    it('names what’s wrong with a document, and adds the rest', async () => {
      const r = await addPrivateLessons(
        s,
        [{ title: '', lines: [] }, { ...lesson3, vocab: [{ word: '朝' }] }, { title: 'ok', lines: [{ ja: 'はい。' }] }, { title: 'ok', lines: [{ ja: 'いいえ。' }] }],
        files().read,
        memoryPrefs(),
        T0,
      )
      expect(r.added).toBe(1)
      expect(r.problems).toEqual(['#1: missing title; no lines', 'Genki I L3 会話: word 1 needs "word" and "en"', 'ok: duplicate title'])
    })
  })
}
