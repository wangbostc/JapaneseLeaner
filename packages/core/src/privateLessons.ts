import type { KeyValueStore } from './seed'
import type { Sentence } from './model'
import type { Store } from './store'

/**
 * Lessons kept only on this computer: the learner's own material (a textbook they have rights
 * to, like Genki), in the local MongoDB's `kikitori.privateLessons`. The macOS app reads them at
 * start and adds them to its database; they're never committed, built into the web app, or
 * exported as starter lessons (scripts/lessons.mjs refuses them).
 *
 * A document:
 *
 *   {
 *     title: 'Genki I L3 会話',              // unique: the lesson's identity (uid `private:<title>`)
 *     book: 'Genki I', chapter: 3,          // shown as "Genki I · L3" (or give `label` yourself)
 *     audio: '/Users/me/Genki/L3-kaiwa.mp3', // optional; needs start and end on every line
 *     lines: [{ ja: '…', en: '…', zh: '…', start: 1.2, end: 3.4 }, …],
 *     vocab: [{ word: '朝', reading: 'あさ', en: 'morning' }, …],   // optional: flashcards
 *   }
 */
export interface PrivateLine {
  ja: string
  en?: string
  zh?: string
  /** Seconds into `audio`. */
  start?: number
  end?: number
}

export interface PrivateWord {
  word: string
  reading?: string
  /** Its meaning in English, shown on the card (the book's own gloss). */
  en: string
}

export interface PrivateLessonDoc {
  title: string
  book?: string
  chapter?: number
  /** Shown on the lesson; defaults to "<book> · L<chapter>". */
  label?: string
  /** An audio file on this computer. */
  audio?: string
  lines: PrivateLine[]
  vocab?: PrivateWord[]
}

export const privateUid = (title: string) => `private:${title}`
const wordUid = (title: string, word: string) => `private:${title}|${word}`

export const labelOf = (d: Pick<PrivateLessonDoc, 'label' | 'book' | 'chapter'>) =>
  d.label ?? (d.book && d.chapter !== undefined ? `${d.book} · L${d.chapter}` : d.book)

const text = (v: unknown) => typeof v === 'string' && v.trim() !== ''
const seconds = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The documents that can be used, and what's wrong with the rest (one line each). */
export function checkPrivateLessons(docs: unknown[]): { lessons: PrivateLessonDoc[]; problems: string[] } {
  const lessons: PrivateLessonDoc[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  docs.forEach((raw, i) => {
    const d = (raw ?? {}) as Record<string, unknown>
    const name = text(d.title) ? (d.title as string) : `#${i + 1}`
    const wrong: string[] = []
    if (!text(d.title)) wrong.push('missing title')
    else if (seen.has(d.title as string)) wrong.push('duplicate title')
    if (!Array.isArray(d.lines) || d.lines.length === 0) wrong.push('no lines')
    const lines = Array.isArray(d.lines) ? (d.lines as Record<string, unknown>[]) : []
    lines.forEach((l, j) => {
      if (!text(l?.ja)) wrong.push(`line ${j + 1} has no "ja"`)
      if ((l?.start !== undefined && !seconds(l.start)) || (l?.end !== undefined && !seconds(l.end))) wrong.push(`line ${j + 1} has a bad start or end`)
    })
    if (d.audio !== undefined && !text(d.audio)) wrong.push('"audio" must be a file path')
    if (d.vocab !== undefined && !Array.isArray(d.vocab)) wrong.push('"vocab" must be a list')
    const vocab = Array.isArray(d.vocab) ? (d.vocab as Record<string, unknown>[]) : []
    vocab.forEach((w, j) => {
      if (!text(w?.word) || !text(w?.en)) wrong.push(`word ${j + 1} needs "word" and "en"`)
    })
    if (wrong.length) return problems.push(`${name}: ${wrong.join('; ')}`)
    seen.add(d.title as string)
    lessons.push({
      title: (d.title as string).trim(),
      book: text(d.book) ? (d.book as string) : undefined,
      chapter: typeof d.chapter === 'number' ? d.chapter : undefined,
      label: text(d.label) ? (d.label as string) : undefined,
      audio: text(d.audio) ? (d.audio as string) : undefined,
      lines: lines.map((l) => ({ ja: (l.ja as string).trim(), en: l.en as string | undefined, zh: l.zh as string | undefined, start: l.start as number | undefined, end: l.end as number | undefined })),
      vocab: vocab.map((w) => ({ word: (w.word as string).trim(), reading: text(w.reading) ? (w.reading as string) : undefined, en: w.en as string })),
    })
  })
  return { lessons, problems }
}

/** A lesson's audio, read from disk; `stamp` changes when the file does. Null if unreadable. */
export type ReadAudio = (path: string) => Promise<{ blob: Blob; name: string; stamp: string } | null>

/** What each private lesson looked like when last added or updated, by uid. */
const LEDGER = 'kikitori.privateLessons'

/** A short, stable fingerprint (FNV-1a), to notice a lesson that changed in MongoDB. */
function fingerprint(value: unknown): string {
  let h = 2166136261
  for (const ch of JSON.stringify(value)) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return (h >>> 0).toString(36)
}

export interface PrivateResult {
  added: number
  updated: number
  cards: number
  problems: string[]
}

/**
 * Adds the private lessons this device hasn't got, and updates those changed in MongoDB since
 * (their progress kept). A lesson or card deleted here stays deleted. Audio is attached only when
 * every line has a start and an end; otherwise the lesson is read aloud.
 */
export async function addPrivateLessons(store: Store, docs: unknown[], readAudio: ReadAudio, prefs: KeyValueStore, now = Date.now()): Promise<PrivateResult> {
  const { db } = store
  const { lessons, problems } = checkPrivateLessons(docs)
  let ledger: Record<string, string> = {}
  try {
    ledger = JSON.parse(prefs.getItem(LEDGER) ?? '{}')
  } catch {
    // start afresh: every lesson is compared with what's stored
  }
  const result: PrivateResult = { added: 0, updated: 0, cards: 0, problems }
  const deleted = new Set((await db.deletions.all()).map((d) => d.uid))

  for (const doc of lessons) {
    const uid = privateUid(doc.title)
    if (deleted.has(uid)) continue
    const timed = doc.lines.every((l) => l.start !== undefined && l.end !== undefined)
    let audio = null
    if (doc.audio && !timed) problems.push(`${doc.title}: its audio needs a start and end on every line; read aloud for now`)
    else if (doc.audio) {
      audio = await readAudio(doc.audio)
      if (!audio) problems.push(`${doc.title}: can't read ${doc.audio}; read aloud for now`)
    }
    const print = fingerprint([labelOf(doc), doc.lines, audio?.stamp ?? null, doc.vocab ?? []])
    const sentences: Sentence[] = doc.lines.map((l) => ({
      text: l.ja,
      start: audio ? l.start! : null,
      end: audio ? l.end! : null,
      translations: { ...(l.en ? { en: l.en } : {}), ...(l.zh ? { zh: l.zh } : {}) },
    }))

    const [existing] = await db.lessons.where('uid', [uid])
    let lessonId: number
    if (!existing) {
      lessonId = await store.createLesson({ title: doc.title, level: labelOf(doc), sentences, uid, ...(audio ? { media: { blob: audio.blob, name: audio.name } } : {}) }, now)
      result.added++
    } else {
      lessonId = existing.id!
      if (ledger[uid] === print) continue
      const mediaId = audio ? await db.media.add({ blob: audio.blob, name: audio.name }) : undefined
      const mediaUid = mediaId ? (await db.media.get(mediaId))?.uid : undefined
      if (existing.mediaId) await db.media.delete([existing.mediaId])
      // Sentences that changed in number leave the old places meaningless.
      const same = existing.sentences.length === sentences.length
      await db.lessons.update(lessonId, {
        level: labelOf(doc),
        sentences,
        mediaId,
        mediaUid,
        hard: same ? existing.hard : existing.hard.filter((i) => i < sentences.length),
        resume: same ? existing.resume : null,
      })
      result.updated++
    }

    for (const w of doc.vocab ?? []) {
      const cardUid = wordUid(doc.title, w.word)
      if (deleted.has(cardUid)) continue
      const [card] = await db.cards.where('uid', [cardUid])
      if (card) {
        if (card.reading !== (w.reading ?? '') || card.gloss !== w.en) await db.cards.update(card.id!, { reading: w.reading ?? '', gloss: w.en })
        continue
      }
      await store.addCard({ uid: cardUid, lessonId, kind: 'word', front: w.word, reading: w.reading ?? '', context: '', gloss: w.en }, now)
      result.cards++
    }
    ledger[uid] = print
  }
  prefs.setItem(LEDGER, JSON.stringify(ledger))
  return result
}
