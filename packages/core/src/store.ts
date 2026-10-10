import type { Database } from './database'
import { nextStamp, type Flashcard, type Lesson, type PracticeLog, type Resume, type Sentence, type UiLang } from './model'
import { completeRound, dueAt, isGraduated, type LessonProgress } from './schedule'
import { newCard, review, type Grade } from './srs'

/** Local midnight of the day containing `ms`: streaks follow the learner's clock, not UTC. */
export function localDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Local midnight `n` days before `day` (DST-safe: steps by calendar date, not 24h). */
function daysBefore(day: number, n: number): number {
  const d = new Date(day)
  d.setDate(d.getDate() - n)
  return d.getTime()
}

export interface NewLesson {
  title: string
  sentences: Sentence[]
  level?: string
  builtIn?: boolean
  uid?: string
  /** Defaults to `now`; seeding uses 0 so a sample deleted on another device stays deleted. */
  updatedAt?: number
}

/** A new lesson's row, before storage gives it an id (and a uid, if it has none). */
export function newLessonRow(input: NewLesson & { mediaId?: number; mediaUid?: string }, now = Date.now()): Lesson {
  return {
    title: input.title,
    level: input.level,
    sentences: input.sentences,
    mediaId: input.mediaId,
    mediaUid: input.mediaUid,
    progress: { roundsDone: 0, lastCompletedAt: null },
    resume: null,
    hard: [],
    createdAt: now,
    builtIn: input.builtIn,
    uid: input.uid,
    updatedAt: input.updatedAt ?? now,
  }
}

/** The app's operations on lessons, cards and logs, over any storage backend. */
/** A card as it was before a grade, to undo it. */
export interface GradeUndo {
  id: number
  card: Flashcard['card']
  updatedAt: Flashcard['updatedAt']
}

export function createStore(database: Database) {
  return {
    db: database,

    async createLesson(input: NewLesson & { media?: { blob: Blob; name: string } }, now = Date.now()) {
      const mediaId = input.media ? await database.media.add(input.media) : undefined
      const mediaUid = mediaId ? (await database.media.get(mediaId))?.uid : undefined
      return database.lessons.add(newLessonRow({ ...input, mediaId, mediaUid }, now))
    },

    /** Deletes a lesson with its audio and cards, leaving tombstones so other devices delete them too. */
    async deleteLesson(id: number, now = Date.now()) {
      await database.transaction(async () => {
        const lesson = await database.lessons.get(id)
        if (!lesson) return
        const cards = await database.cards.where('lessonId', [id])
        const media = lesson.mediaId ? await database.media.get(lesson.mediaId) : undefined
        // A deletion must be later than the version it deletes, whatever this device's clock says.
        const tombstones = [
          { uid: lesson.uid!, table: 'lessons' as const, at: nextStamp(lesson.updatedAt, now) },
          ...(media ? [{ uid: media.uid!, table: 'media' as const, at: nextStamp(media.updatedAt, now) }] : []),
          ...cards.map((c) => ({ uid: c.uid!, table: 'cards' as const, at: nextStamp(c.updatedAt, now) })),
        ]
        // Replace any earlier tombstone for the same uid (a record deleted, brought back by a later edit elsewhere, deleted again).
        const earlier = await database.deletions.where('uid', tombstones.map((t) => t.uid))
        await database.deletions.delete(earlier.map((t) => t.id!))
        await database.deletions.bulkAdd(tombstones)
        if (lesson.mediaId) await database.media.delete(lesson.mediaId)
        await database.cards.delete(cards.map((c) => c.id!))
        await database.lessons.delete(id)
      })
    },

    /** Stores one translation per sentence for `lang`, keeping other languages. */
    async setTranslations(id: number, lang: UiLang, translations: string[]) {
      await database.transaction(async () => {
        const lesson = await database.lessons.get(id)
        if (!lesson || lesson.sentences.length !== translations.length) throw new Error('translation count mismatch')
        const sentences = lesson.sentences.map((s, i) => ({ ...s, translations: { ...s.translations, [lang]: translations[i] } }))
        await database.lessons.update(id, { sentences })
      })
    },

    saveResume: (id: number, resume: Resume | null) => database.lessons.update(id, { resume }),

    async setHard(id: number, index: number, hard: boolean) {
      await database.transaction(async () => {
        const lesson = await database.lessons.get(id)
        if (!lesson) return
        const set = new Set(lesson.hard)
        if (hard) set.add(index)
        else set.delete(index)
        await database.lessons.update(id, { hard: [...set].sort((a, b) => a - b) })
      })
    },

    /**
     * Completes round `expectedRound`. A repeat call for the same round (a
     * double tap on Done) is a no-op instead of skipping the next review.
     */
    async finishRound(id: number, expectedRound: number, now = Date.now()): Promise<LessonProgress | undefined> {
      return database.transaction(async () => {
        const lesson = await database.lessons.get(id)
        if (!lesson) return undefined
        if (lesson.progress.roundsDone !== expectedRound) return lesson.progress
        const progress = completeRound(lesson.progress, now)
        await database.lessons.update(id, { progress, resume: null })
        return progress
      })
    },

    /**
     * Lessons in study order. Due reviews come before new lessons, since a
     * review loses value the longer it waits; then upcoming, then graduated.
     */
    async agenda(now = Date.now()) {
      const lessons = await database.lessons.all()
      const due = (l: Lesson) => (isGraduated(l.progress) ? Infinity : dueAt(l.progress)!)
      const isNew = (l: Lesson) => (l.progress.roundsDone === 0 ? 1 : 0)
      const sorted = lessons.sort((a, b) => isNew(a) - isNew(b) || due(a) - due(b) || a.createdAt - b.createdAt)
      return {
        due: sorted.filter((l) => due(l) <= now),
        upcoming: sorted.filter((l) => due(l) > now && due(l) !== Infinity).sort((a, b) => due(a) - due(b)),
        graduated: sorted.filter((l) => due(l) === Infinity),
      }
    },

    /** Saves a word or sentence card once per lesson; returns the existing id if already saved. */
    async addCard(input: Omit<Flashcard, 'id' | 'card' | 'createdAt'>, now = Date.now()) {
      const existing = (await database.cards.where('lessonId', [input.lessonId])).find((c) => c.front === input.front)
      // One waiting to be brought in (a private chapter's word; see privateLessons.ts) comes in when saved.
      if (existing?.suspendedAt !== undefined && existing.suspendedAt === existing.createdAt) await database.cards.update(existing.id!, { suspendedAt: undefined })
      if (existing) return existing.id!
      return database.cards.add({ ...input, card: newCard(new Date(now)), createdAt: now })
    },

    async removeCard(id: number, now = Date.now()) {
      await database.transaction(async () => {
        const card = await database.cards.get(id)
        if (!card) return
        await database.deletions.delete((await database.deletions.where('uid', [card.uid!])).map((t) => t.id!))
        await database.deletions.add({ uid: card.uid!, table: 'cards', at: nextStamp(card.updatedAt, now) })
        await database.cards.delete(id)
      })
    },

    /** Cards due by `now`, suspended ones aside. */
    dueCards: async (now = Date.now()) => (await database.cards.dueBy(new Date(now))).filter((c) => !c.suspendedAt),

    /** Every card, for browsing. */
    allCards: () => database.cards.all(),

    /** Suspends a card (kept, but never due) or resumes it, due as it was scheduled. */
    async setSuspended(id: number, suspended: boolean, now = Date.now()) {
      const c = await database.cards.get(id)
      if (!c || !!c.suspendedAt === suspended) return
      await database.cards.update(id, { suspendedAt: suspended ? now : undefined })
    },

    /**
     * Corrects a card's reading, or a saved word's spelling. What stays fixed: a core word's front
     * (its identity, core:<word>; coreWords.ts imports this module), a sentence card's text and a
     * card's context sentence (both are the lesson's sentence, which finds its translation and is
     * what plays). A spelling another card of the same lesson has is refused ('duplicate'): the
     * lesson would have two cards for one word.
     */
    async editCard(id: number, changes: Partial<Pick<Flashcard, 'front' | 'reading'>>): Promise<'ok' | 'duplicate'> {
      const c = await database.cards.get(id)
      if (!c) return 'ok'
      const front = changes.front?.trim()
      const next: Partial<Flashcard> = {}
      if (changes.reading !== undefined) next.reading = changes.reading.trim()
      if (front && front !== c.front && c.kind === 'word' && !c.uid?.startsWith('core:')) {
        if ((await database.cards.where('lessonId', [c.lessonId])).some((o) => o.id !== id && o.front === front)) return 'duplicate'
        next.front = front
      }
      if (Object.entries(next).some(([k, v]) => c[k as keyof Flashcard] !== v)) await database.cards.update(id, next)
      return 'ok'
    },

    /** Grades a card; returns what it was before (for undoGrade), or null if it's gone. */
    async gradeCard(id: number, grade: Grade, now = Date.now()): Promise<GradeUndo | null> {
      const c = await database.cards.get(id)
      if (!c) return null
      await database.cards.update(id, { card: review(c.card, grade, new Date(now)) })
      return { id, card: c.card, updatedAt: c.updatedAt }
    },

    /**
     * Puts a graded card back as it was, if the grade hasn't been sent to the server: once it
     * has, the server keeps the later review (merge.ts), so an undo would come back undone.
     * The card's own updatedAt comes back too, so nothing is left to sync (and an unreviewed
     * core card stays unsynced). Returns whether it was undone.
     */
    async undoGrade(before: GradeUndo): Promise<boolean> {
      return database.transaction(async () => {
        const c = await database.cards.get(before.id)
        if (!c || (c.syncedVersion !== undefined && c.syncedVersion === c.updatedAt)) return false
        await database.cards.update(before.id, { card: before.card, updatedAt: before.updatedAt })
        return true
      })
    },

    async log(entry: Omit<PracticeLog, 'id' | 'lessonUid'>) {
      if (entry.ms <= 0) return undefined
      const lesson = await database.lessons.get(entry.lessonId)
      return database.logs.add({ ...entry, lessonUid: lesson?.uid ?? null })
    },

    async addKnownWords(lemmas: Iterable<string>, now = Date.now()) {
      const existing = new Set((await database.words.all()).map((w) => w.lemma))
      const fresh = [...new Set(lemmas)].filter((l) => !existing.has(l)).map((lemma) => ({ lemma, firstSeen: now }))
      if (fresh.length) await database.words.bulkAdd(fresh)
      return fresh.length
    },

    async stats(now = Date.now()) {
      const logs = await database.logs.all()
      const sum = (xs: PracticeLog[]) => xs.reduce((n, l) => n + l.ms, 0)
      const input = sum(logs.filter((l) => l.mode === 'input'))
      const output = sum(logs.filter((l) => l.mode === 'output'))
      const days = new Set(logs.map((l) => localDay(l.at)))
      const today = localDay(now)
      let streak = 0
      while (days.has(daysBefore(today, streak))) streak++
      const lastWeek = Array.from({ length: 7 }, (_, i) => {
        const day = daysBefore(today, 6 - i)
        return { day, ms: sum(logs.filter((l) => localDay(l.at) === day)) }
      })
      return {
        totalMs: input + output,
        inputMs: input,
        outputMs: output,
        words: await database.words.count(),
        cards: await database.cards.count(),
        streak,
        lastWeek,
      }
    },
  }
}

export type Store = ReturnType<typeof createStore>
