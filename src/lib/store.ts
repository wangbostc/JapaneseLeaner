import { db, nextStamp, type Flashcard, type KikitoriDB, type Lesson, type PracticeLog, type Resume, type Sentence, type UiLang } from './db'
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

export function createStore(database: KikitoriDB = db) {
  return {
    db: database,

    async createLesson(
      input: {
        title: string
        sentences: Sentence[]
        level?: string
        media?: { blob: Blob; name: string }
        builtIn?: boolean
        uid?: string
        /** Defaults to `now`; seeding uses 0 so a sample deleted on another device stays deleted. */
        updatedAt?: number
      },
      now = Date.now(),
    ) {
      const mediaId = input.media ? ((await database.media.add(input.media)) as number) : undefined
      const mediaUid = mediaId ? (await database.media.get(mediaId))?.uid : undefined
      return (await database.lessons.add({
        title: input.title,
        level: input.level,
        sentences: input.sentences,
        mediaId,
        mediaUid,
        progress: { roundsDone: 0, lastCompletedAt: null },
        resume: null,
        hard: [],
        createdAt: now,
        builtIn: input.builtIn,
        uid: input.uid,
        updatedAt: input.updatedAt ?? now,
      })) as number
    },

    /** Deletes a lesson with its audio and cards, leaving tombstones so other devices delete them too. */
    async deleteLesson(id: number, now = Date.now()) {
      await database.transaction('rw', [database.lessons, database.media, database.cards, database.logs, database.deletions], async () => {
        const lesson = await database.lessons.get(id)
        if (!lesson) return
        const cards = await database.cards.where('lessonId').equals(id).toArray()
        const media = lesson.mediaId ? await database.media.get(lesson.mediaId) : undefined
        // A deletion must be later than the version it deletes, whatever this device's clock says.
        const tombstones = [
          { uid: lesson.uid!, table: 'lessons' as const, at: nextStamp(lesson.updatedAt, now) },
          ...(media ? [{ uid: media.uid!, table: 'media' as const, at: nextStamp(media.updatedAt, now) }] : []),
          ...cards.map((c) => ({ uid: c.uid!, table: 'cards' as const, at: nextStamp(c.updatedAt, now) })),
        ]
        // Replace any earlier tombstone for the same uid (a record deleted, brought back by a later edit elsewhere, deleted again).
        await database.deletions.where('uid').anyOf(tombstones.map((t) => t.uid)).delete()
        await database.deletions.bulkAdd(tombstones)
        if (lesson.mediaId) await database.media.delete(lesson.mediaId)
        await database.cards.where('lessonId').equals(id).delete()
        await database.lessons.delete(id)
      })
    },

    /** Stores one translation per sentence for `lang`, keeping other languages. */
    async setTranslations(id: number, lang: UiLang, translations: string[]) {
      await database.transaction('rw', database.lessons, async () => {
        const lesson = await database.lessons.get(id)
        if (!lesson || lesson.sentences.length !== translations.length) throw new Error('translation count mismatch')
        const sentences = lesson.sentences.map((s, i) => ({ ...s, translations: { ...s.translations, [lang]: translations[i] } }))
        await database.lessons.update(id, { sentences })
      })
    },

    saveResume: (id: number, resume: Resume | null) => database.lessons.update(id, { resume }),

    async setHard(id: number, index: number, hard: boolean) {
      await database.transaction('rw', database.lessons, async () => {
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
      return database.transaction('rw', database.lessons, async () => {
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
      const lessons = await database.lessons.toArray()
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
      const existing = await database.cards.where({ lessonId: input.lessonId, front: input.front }).first()
      if (existing) return existing.id!
      return (await database.cards.add({ ...input, card: newCard(new Date(now)), createdAt: now })) as number
    },

    async removeCard(id: number, now = Date.now()) {
      await database.transaction('rw', [database.cards, database.deletions], async () => {
        const card = await database.cards.get(id)
        if (!card) return
        await database.deletions.where('uid').equals(card.uid!).delete()
        await database.deletions.add({ uid: card.uid!, table: 'cards', at: nextStamp(card.updatedAt, now) })
        await database.cards.delete(id)
      })
    },

    dueCards: (now = Date.now()) => database.cards.where('card.due').belowOrEqual(new Date(now)).toArray(),

    async gradeCard(id: number, grade: Grade, now = Date.now()) {
      const c = await database.cards.get(id)
      if (!c) return
      await database.cards.update(id, { card: review(c.card, grade, new Date(now)) })
    },

    async log(entry: Omit<PracticeLog, 'id' | 'lessonUid'>) {
      if (entry.ms <= 0) return undefined
      const lesson = await database.lessons.get(entry.lessonId)
      return database.logs.add({ ...entry, lessonUid: lesson?.uid ?? null })
    },

    async addKnownWords(lemmas: Iterable<string>, now = Date.now()) {
      const existing = new Set((await database.words.toCollection().primaryKeys()) as string[])
      const fresh = [...new Set(lemmas)].filter((l) => !existing.has(l)).map((lemma) => ({ lemma, firstSeen: now }))
      if (fresh.length) await database.words.bulkAdd(fresh)
      return fresh.length
    },

    async stats(now = Date.now()) {
      const logs = await database.logs.toArray()
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
export const store = createStore()
