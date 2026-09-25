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
  for (const lesson of sampleLessons()) await store.createLesson({ ...lesson, uid: sampleUid(lesson.title) }, t++)
}
