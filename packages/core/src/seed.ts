import { sampleUid } from './model'
import { sampleLessons } from './samples'
import type { Store } from './store'

/** Where a device remembers small values: localStorage in a browser, a prefs file elsewhere. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const browserStorage = () => (globalThis as { localStorage?: KeyValueStore }).localStorage

/** The uids of the samples this device has added: each is added once, so deleting one sticks. */
const SEEDED_KEY = 'kikitori.seededSamples'
/** Set by releases that seeded all their samples at once: these three. */
const LEGACY_KEY = 'kikitori.seeded'
const LEGACY_SAMPLES = ['私の朝', '週末のカフェ', '雨の日の過ごし方'].map(sampleUid)

/** Marks `uids` as added and returns those that weren't yet; null when there's no storage. */
function claim(uids: string[], storage: () => KeyValueStore | undefined): string[] | null {
  try {
    // Reading localStorage itself can throw (storage blocked), hence the getter inside the try.
    const kv = storage()
    if (!kv) return null
    const raw = kv.getItem(SEEDED_KEY)
    const seeded = new Set<string>(raw ? JSON.parse(raw) : kv.getItem(LEGACY_KEY) ? LEGACY_SAMPLES : [])
    const fresh = uids.filter((uid) => !seeded.has(uid))
    if (fresh.length || !raw) kv.setItem(SEEDED_KEY, JSON.stringify([...seeded, ...fresh]))
    return fresh
  } catch {
    return null
  }
}

/**
 * Adds the starter lessons this device hasn't had yet: all of them on first run, and any that
 * a later release brings. Each is added at most once, so deleting one sticks.
 */
export async function seedOnce(store: Store, storage: () => KeyValueStore | undefined = browserStorage) {
  const samples = sampleLessons().map((lesson) => ({ ...lesson, uid: sampleUid(lesson.title) }))
  // Claimed before any await, so a second call racing this one (StrictMode) finds nothing to add.
  const claimed = claim(samples.map((s) => s.uid), storage)
  const wanted = claimed ? samples.filter((s) => claimed.includes(s.uid)) : samples
  if (!wanted.length) return
  const { db } = store
  await db.transaction(async () => {
    // Already here (synced from a device that added it first), or deleted here: leave it be.
    const uids = wanted.map((s) => s.uid)
    const [present, deleted] = await Promise.all([db.lessons.where('uid', uids), db.deletions.where('uid', uids)])
    const skip = new Set([...present, ...deleted].map((r) => r.uid))
    let t = Date.now()
    // updatedAt 0: a sample is the oldest possible version, so a deletion synced from another
    // device always wins over this fresh copy instead of resurrecting it.
    for (const lesson of wanted) if (!skip.has(lesson.uid)) await store.createLesson({ ...lesson, updatedAt: 0 }, t++)
  })
}
