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

/**
 * A lesson's chapter, from its label: "Genki I · L3" for both "Genki I · L3" (its dialogues) and
 * "Genki I · L3 読み書き" (its readings), so studying either brings in the chapter's words.
 */
const chapterOf = (level: string | undefined) => level?.replace(/\s*読み書き$/, '') || null

/**
 * A private lesson's word cards wait until the learner first studies that chapter (hundreds of
 * new cards at once would bury the reviews). They wait suspended, marked by a suspension at the
 * card's own creation time, so bringing them in never resumes a card the learner suspended.
 */
const waiting = (c: { suspendedAt?: number; createdAt: number }) => c.suspendedAt === c.createdAt

/** Whether any lesson of `chapter` has been studied (a round finished, or one under way). */
async function studied(store: Store, chapter: string | null) {
  if (!chapter) return true
  const lessons = (await store.db.lessons.all()).filter((l) => l.uid?.startsWith('private:') && chapterOf(l.level) === chapter)
  return lessons.some((l) => l.progress.roundsDone > 0 || l.resume !== null)
}

/** Brings in the waiting word cards of `lessonId`'s chapter: called as the learner starts studying it. */
export async function releaseChapterCards(store: Store, lessonId: number): Promise<number> {
  const { db } = store
  const lesson = await db.lessons.get(lessonId)
  if (!lesson?.uid?.startsWith('private:')) return 0
  const chapter = chapterOf(lesson.level)
  const ids = new Set((await db.lessons.all()).filter((l) => l.uid?.startsWith('private:') && chapterOf(l.level) === chapter).map((l) => l.id!))
  const cards = (await db.cards.all()).filter((c) => ids.has(c.lessonId) && waiting(c))
  for (const c of cards) await db.cards.update(c.id!, { suspendedAt: undefined })
  return cards.length
}

const text = (v: unknown) => typeof v === 'string' && v.trim() !== ''
const seconds = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The documents that can be used, and what's wrong with the rest (one line each). */
export function checkPrivateLessons(docs: unknown[]): { lessons: PrivateLessonDoc[]; problems: string[] } {
  const lessons: PrivateLessonDoc[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  docs.forEach((raw, i) => {
    const d = (raw ?? {}) as Record<string, unknown>
    // Trimmed, as the uid is: "Dup" and "Dup " are one lesson.
    const title = text(d.title) ? (d.title as string).trim() : ''
    const name = title || `#${i + 1}`
    const wrong: string[] = []
    if (!title) wrong.push('missing title')
    else if (seen.has(title)) wrong.push('duplicate title')
    if (!Array.isArray(d.lines) || d.lines.length === 0) wrong.push('no lines')
    const lines = Array.isArray(d.lines) ? (d.lines as Record<string, unknown>[]) : []
    lines.forEach((l, j) => {
      if (!text(l?.ja)) wrong.push(`line ${j + 1} has no "ja"`)
      for (const key of ['en', 'zh'] as const) if (l?.[key] !== undefined && typeof l[key] !== 'string') wrong.push(`line ${j + 1}: "${key}" must be text`)
      if ((l?.start !== undefined && !seconds(l.start)) || (l?.end !== undefined && !seconds(l.end))) wrong.push(`line ${j + 1} has a bad start or end`)
    })
    if (d.audio !== undefined && !text(d.audio)) wrong.push('"audio" must be a file path')
    if (d.vocab !== undefined && !Array.isArray(d.vocab)) wrong.push('"vocab" must be a list')
    const vocab = Array.isArray(d.vocab) ? (d.vocab as Record<string, unknown>[]) : []
    const words = new Set<string>()
    vocab.forEach((w, j) => {
      if (!text(w?.word) || !text(w?.en)) return wrong.push(`word ${j + 1} needs "word" and "en"`)
      // One card per word in a lesson (its id): a second entry would overwrite the first.
      if (words.has((w.word as string).trim())) wrong.push(`word ${j + 1} (${w.word}) is listed twice`)
      words.add((w.word as string).trim())
    })
    if (wrong.length) return problems.push(`${name}: ${wrong.join('; ')}`)
    seen.add(title)
    lessons.push({
      title,
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

/**
 * A lesson's audio on disk: `stamp` is cheap (size and modification time, changing when the file
 * does), `read` loads it, only for a lesson being added or updated. Each gives null for a file
 * that's missing or can't be read.
 */
export interface ReadAudio {
  stamp(path: string): Promise<string | null>
  read(path: string): Promise<{ blob: Blob; name: string } | null>
}

/** What each private lesson looked like when last added or updated, by uid. */
const LEDGER = 'kikitori.privateLessons'

/**
 * Forgets what was added, so the next start compares every lesson afresh: after restoring a
 * backup, whose lessons may be older than what's in MongoDB.
 */
export const forgetPrivateLessons = (prefs: KeyValueStore) => prefs.setItem(LEDGER, '{}')

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
 * every line has a start and an end; otherwise the lesson is read aloud. One lesson that fails
 * (its audio unreadable, say) is reported and skipped; the rest still come in.
 */
export async function addPrivateLessons(store: Store, docs: unknown[], audioFiles: ReadAudio, prefs: KeyValueStore, now = Date.now()): Promise<PrivateResult> {
  const { lessons, problems } = checkPrivateLessons(docs)
  let ledger: Record<string, string> = {}
  try {
    ledger = JSON.parse(prefs.getItem(LEDGER) ?? '{}')
  } catch {
    // start afresh: every lesson is compared with what's stored
  }
  const result: PrivateResult = { added: 0, updated: 0, cards: 0, problems }
  const deleted = new Set((await store.db.deletions.all()).map((d) => d.uid))
  for (const doc of lessons) {
    try {
      await addOne(store, doc, audioFiles, ledger, deleted, result, now)
    } catch (e) {
      problems.push(`${doc.title}: not added (${e instanceof Error ? e.message : String(e)})`)
    }
    // Saved as it goes: a lesson done isn't redone if a later one stops the app.
    prefs.setItem(LEDGER, JSON.stringify(ledger))
  }
  return result
}

async function addOne(store: Store, doc: PrivateLessonDoc, audioFiles: ReadAudio, ledger: Record<string, string>, deleted: Set<string>, result: PrivateResult, now: number) {
  const { db } = store
  const uid = privateUid(doc.title)
  if (deleted.has(uid)) return
  const timed = doc.lines.every((l) => l.start !== undefined && l.end !== undefined)
  let stamp: string | null = null
  if (doc.audio && !timed) result.problems.push(`${doc.title}: its audio needs a start and end on every line; read aloud for now`)
  else if (doc.audio) {
    stamp = await audioFiles.stamp(doc.audio)
    if (!stamp) result.problems.push(`${doc.title}: can't read ${doc.audio}; read aloud for now`)
  }
  const print = fingerprint([labelOf(doc), doc.lines, stamp, doc.vocab ?? []])
  const [existing] = await db.lessons.where('uid', [uid])
  const changed = !existing || ledger[uid] !== print
  // Remembered only when its audio came in as asked: audio that couldn't be read (macOS not
  // yet allowing it, say) is tried again next start, though the file itself hasn't changed.
  let complete = true
  if (changed) {
    // The audio's bytes only now: an unchanged lesson costs a file stat, not a read.
    const audio = stamp ? await audioFiles.read(doc.audio!) : null
    if (stamp && !audio) {
      result.problems.push(`${doc.title}: can't read ${doc.audio}; read aloud for now`)
      complete = false
    }
    // Audio already there that just couldn't be read again stays, with its timings.
    const keep = !audio && !complete && !!existing?.mediaId
    const timedNow = !!audio || keep
    const sentences: Sentence[] = doc.lines.map((l) => ({
      text: l.ja,
      start: timedNow ? l.start! : null,
      end: timedNow ? l.end! : null,
      translations: { ...(l.en ? { en: l.en } : {}), ...(l.zh ? { zh: l.zh } : {}) },
    }))
    if (!existing) {
      await store.createLesson({ title: doc.title, level: labelOf(doc), sentences, uid, ...(audio ? { media: audio } : {}) }, now)
      result.added++
    } else {
      // Read again inside the transaction: a sentence marked hard meanwhile isn't lost.
      await db.transaction(async () => {
        const lesson = await db.lessons.get(existing.id!)
        if (!lesson) return
        let { mediaId, mediaUid } = lesson
        if (!keep) {
          const added = audio ? await db.media.add(audio) : undefined
          mediaUid = added ? (await db.media.get(added))?.uid : undefined
          if (lesson.mediaId) await db.media.delete([lesson.mediaId])
          mediaId = added
        }
        // Lines changed in number leave the old places meaningless.
        const same = lesson.sentences.length === sentences.length
        await db.lessons.update(lesson.id!, { level: labelOf(doc), sentences, mediaId, mediaUid, hard: same ? lesson.hard : [], resume: same ? lesson.resume : null })
      })
      result.updated++
    }
  }
  // Cards follow the document when it changes (a card edited here keeps its edit otherwise);
  // one missing is added back unless it was deleted here.
  const [lesson] = await db.lessons.where('uid', [uid])
  const open = await studied(store, chapterOf(labelOf(doc)))
  for (const w of doc.vocab ?? []) {
    const cardUid = wordUid(doc.title, w.word)
    if (deleted.has(cardUid)) continue
    const [card] = await db.cards.where('uid', [cardUid])
    if (card) {
      if (changed && (card.reading !== (w.reading ?? '') || card.gloss !== w.en)) await db.cards.update(card.id!, { reading: w.reading ?? '', gloss: w.en })
      // Added due by an earlier version: waits too, if never reviewed and its chapter not studied.
      if (!open && !card.suspendedAt && card.card.reps === 0) await db.cards.update(card.id!, { suspendedAt: card.createdAt })
      continue
    }
    const id = await store.addCard({ uid: cardUid, lessonId: lesson.id!, kind: 'word', front: w.word, reading: w.reading ?? '', context: '', gloss: w.en }, now)
    if (!open) await db.cards.update(id, { suspendedAt: (await db.cards.get(id))!.createdAt })
    result.cards++
  }
  if (complete) ledger[uid] = print
  else delete ledger[uid]
}
