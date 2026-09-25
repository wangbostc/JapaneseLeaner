import { sampleLessons } from '../content/samples'
import { sampleUid } from './db'
import type { Store } from './store'

const SEEDED_KEY = 'kikitori.seeded'

/** Adds the starter lessons on first run only, so deleting them sticks. */
export async function seedOnce(store: Store) {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return
    localStorage.setItem(SEEDED_KEY, '1')
  } catch {
    if (await store.db.lessons.count()) return
  }
  if (await store.db.lessons.count()) return
  let t = Date.now()
  // updatedAt 0: a sample is the oldest possible version, so a deletion synced from another
  // device always wins over this fresh copy instead of resurrecting it.
  for (const lesson of sampleLessons()) await store.createLesson({ ...lesson, uid: sampleUid(lesson.title), updatedAt: 0 }, t++)
}
