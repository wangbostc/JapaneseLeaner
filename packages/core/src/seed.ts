import { sampleUid } from './model'
import { sampleLessons } from './samples'
import { newLessonRow, type Store } from './store'

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

/** The samples this device has added, by uid; null when there's no storage. */
function seeded(storage: () => KeyValueStore | undefined): Set<string> | null {
  try {
    // Reading localStorage itself can throw (storage blocked), hence the getter inside the try.
    const kv = storage()
    if (!kv) return null
    const raw = kv.getItem(SEEDED_KEY)
    return new Set<string>(raw ? JSON.parse(raw) : kv.getItem(LEGACY_KEY) ? LEGACY_SAMPLES : [])
  } catch {
    return null
  }
}

/** Records `uids` as added (and carries an older release's ledger over to this one's key). */
function record(uids: string[], storage: () => KeyValueStore | undefined) {
  try {
    const kv = storage()
    if (!kv) return
    const before = seeded(storage) ?? new Set<string>()
    const after = new Set([...before, ...uids])
    if (after.size === before.size && kv.getItem(SEEDED_KEY)) return
    kv.setItem(SEEDED_KEY, JSON.stringify([...after]))
  } catch {
    // storage unavailable: the next start checks the database again
  }
}

/**
 * Adds the starter lessons this device hasn't had yet: all of them on first run, and any that
 * a later release brings. Each is added at most once, so deleting one sticks.
 *
 * They're recorded as added only once they're in the database: recorded first, a page closed
 * or reloaded before the write committed would lose them for good. Two calls racing (StrictMode)
 * are safe all the same: addSamples skips what's already there, inside its transaction.
 */
export async function seedOnce(store: Store, storage: () => KeyValueStore | undefined = browserStorage) {
  const samples = sampleLessons().map((lesson) => ({ ...lesson, uid: sampleUid(lesson.title) }))
  const done = seeded(storage)
  const wanted = done ? samples.filter((s) => !done.has(s.uid)) : samples
  if (!wanted.length) return record([], storage)
  await addSamples(store, wanted)
  record(
    wanted.map((s) => s.uid),
    storage,
  )
}

async function addSamples(store: Store, wanted: (ReturnType<typeof sampleLessons>[number] & { uid: string })[]) {
  const { db } = store
  await db.transaction(async () => {
    // Already here (synced from a device that added it first), or deleted here: leave it be.
    const uids = wanted.map((s) => s.uid)
    const present = await db.lessons.where('uid', uids)
    const deleted = await db.deletions.where('uid', uids)
    const skip = new Set([...present, ...deleted].map((r) => r.uid))
    let t = Date.now()
    // updatedAt 0: a sample is the oldest possible version, so a deletion synced from another
    // device always wins over this fresh copy instead of resurrecting it.
    // The rows are added directly, not through store.createLesson: see Database.transaction.
    for (const lesson of wanted) if (!skip.has(lesson.uid)) await db.lessons.add(newLessonRow({ ...lesson, updatedAt: 0 }, t++))
  })
}
