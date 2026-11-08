import { addPrivateLessons, forgetPrivateLessons, releaseChapterCards, type ReadAudio } from '@kikitori/core/privateLessons'
import type { KeyValueStore } from '@kikitori/core/seed'
import { store } from '../lib/store'
import type { Api } from '@kikitori/core/sync'

/**
 * The learner's private lessons (a textbook of their own, like Genki) from their own server, where
 * scripts/private-lessons.mjs put them. A server that doesn't offer them answers 404, and nothing
 * changes. They're added as on the macOS app: kept on this device, never synced (sync.ts).
 */

/** Audio on the computer that uploaded them can't be opened here: these lessons are read aloud. */
const noAudio: ReadAudio = { stamp: async () => null, read: async () => null }

const memory = new Map<string, string>()
/** localStorage, or this session's memory where storage is blocked. */
export const prefs: KeyValueStore = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return memory.get(key) ?? null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      memory.set(key, value)
    }
  },
}

/** One tab at a time adds them (each keeps a ledger of what it added; two would overwrite each other's). */
const exclusive = (run: () => Promise<void>): Promise<void> =>
  typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('kikitori-private-lessons', run) : run()

let loading: Promise<void> | null = null
/** Adds the server's private lessons this device lacks, and updates changed ones. One run at a time. */
export function loadPrivateLessons(api: Api): Promise<void> {
  loading ??= exclusive(async () => {
    try {
      const res = await api('/api/private-lessons')
      if (!res.ok) return
      const { docs } = (await res.json()) as { docs?: unknown[] }
      if (!Array.isArray(docs) || !docs.length) return
      const r = await addPrivateLessons(store, docs, noAudio, prefs)
      if (r.added || r.updated || r.cards) console.info(`[private] ${r.added} added, ${r.updated} updated, ${r.cards} cards`)
      for (const p of r.problems) console.warn(`[private] ${p}`)
    } catch (e) {
      console.warn('[private] not loaded', e)
    }
  }).finally(() => {
    loading = null
  })
  return loading
}

/** After a backup restore: its private lessons may be older, so the next load compares every one again. */
export const forgetPrivate = () => forgetPrivateLessons(prefs)

/** A private chapter's word cards join the reviews once the learner studies any of its lessons. */
export const releaseChapter = (lessonId: number): Promise<number> =>
  Number.isInteger(lessonId) ? releaseChapterCards(store, lessonId, prefs).catch(() => 0) : Promise.resolve(0)
