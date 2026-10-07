import type { Database } from './database'
import type { Flashcard } from './model'
import { newCard } from './srs'
import { localDay } from './store'
import data from './coreWords.json'

/** The 3,500 most frequent words, [word, reading], most frequent first (see coreWords-LICENSE.txt). */
export const CORE_WORDS = data.words as [string, string][]

/** Choices for "new words per day" (0: off). */
export const NEW_WORDS_PER_DAY = [0, 5, 10, 20, 30] as const
export const DEFAULT_NEW_WORDS_PER_DAY = 10

/** A core word's card has the same uid on every device, so introducing it twice never duplicates it. */
export const coreUid = (word: string) => `core:${word}`
export const isCoreCard = (card: Pick<Flashcard, 'uid'>) => card.uid?.startsWith('core:') ?? false
/** 1-based frequency rank of a core card's word (0 if it isn't one). */
export const coreRank = (card: Pick<Flashcard, 'uid'>) => (isCoreCard(card) ? CORE_WORDS.findIndex(([w]) => coreUid(w) === card.uid) + 1 : 0)

/**
 * Adds up to `perDay` new core-word cards a day (counted by local day), most frequent first.
 * Skips words already introduced, deleted (a tombstone), or saved by the learner from a lesson.
 * Idempotent: call it at start-up and whenever cards are shown. Returns how many it added.
 *
 * Cards are added as the oldest possible version (updatedAt 0), like the starter lessons: a
 * deletion made on another device always wins over a fresh copy introduced here. A card first
 * syncs once it's reviewed.
 */
export async function introduceCoreWords(db: Database, perDay: number, now = Date.now()): Promise<number> {
  if (perDay <= 0) return 0
  return db.transaction(async () => {
    const cards = await db.cards.all()
    const today = localDay(now)
    const introducedToday = cards.filter((c) => isCoreCard(c) && localDay(c.createdAt) === today).length
    const room = perDay - introducedToday
    if (room <= 0) return 0
    const deleted = new Set((await db.deletions.all()).filter((d) => d.uid.startsWith('core:')).map((d) => d.uid))
    const have = new Set(cards.map((c) => (isCoreCard(c) ? c.uid! : c.front)))
    let added = 0
    for (const [word, reading] of CORE_WORDS) {
      if (added >= room) break
      const uid = coreUid(word)
      if (have.has(uid) || have.has(word) || deleted.has(uid)) continue
      // (Awaited one by one, directly: see Database.transaction.)
      await db.cards.add({ uid, updatedAt: 0, lessonId: 0, kind: 'word', front: word, reading, context: '', card: newCard(new Date(now)), createdAt: now + added })
      added++
    }
    return added
  })
}
