import { db, type Flashcard, type KikitoriDB, type Lesson, type PracticeLog, type Resume, type Sentence } from './db'
import { completeRound, dueAt, isGraduated, type LessonProgress } from './schedule'
import { newCard, review, type Grade } from './srs'

const DAY = 86_400_000

export function createStore(database: KikitoriDB = db) {
  return {
    db: database,

    async createLesson(input: { title: string; sentences: Sentence[]; level?: string; media?: { blob: Blob; name: string }; builtIn?: boolean }, now = Date.now()) {
      const mediaId = input.media ? ((await database.media.add(input.media)) as number) : undefined
      return (await database.lessons.add({
        title: input.title,
        level: input.level,
        sentences: input.sentences,
        mediaId,
        progress: { roundsDone: 0, lastCompletedAt: null },
        resume: null,
        hard: [],
        createdAt: now,
        builtIn: input.builtIn,
      })) as number
    },

    async deleteLesson(id: number) {
      await database.transaction('rw', [database.lessons, database.media, database.cards, database.logs], async () => {
        const lesson = await database.lessons.get(id)
        if (lesson?.mediaId) await database.media.delete(lesson.mediaId)
        await database.cards.where('lessonId').equals(id).delete()
        await database.lessons.delete(id)
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

    async finishRound(id: number, now = Date.now()): Promise<LessonProgress | undefined> {
      return database.transaction('rw', database.lessons, async () => {
        const lesson = await database.lessons.get(id)
        if (!lesson) return undefined
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

    removeCard: (id: number) => database.cards.delete(id),

    dueCards: (now = Date.now()) => database.cards.where('card.due').belowOrEqual(new Date(now)).toArray(),

    async gradeCard(id: number, grade: Grade, now = Date.now()) {
      const c = await database.cards.get(id)
      if (!c) return
      await database.cards.update(id, { card: review(c.card, grade, new Date(now)) })
    },

    log: (entry: Omit<PracticeLog, 'id'>) => (entry.ms > 0 ? database.logs.add(entry) : Promise.resolve(undefined)),

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
      const days = new Set(logs.map((l) => Math.floor(l.at / DAY)))
      let streak = 0
      for (let d = Math.floor(now / DAY); days.has(d); d--) streak++
      const lastWeek = Array.from({ length: 7 }, (_, i) => {
        const day = Math.floor(now / DAY) - 6 + i
        return { day, ms: sum(logs.filter((l) => Math.floor(l.at / DAY) === day)) }
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
