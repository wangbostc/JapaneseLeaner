import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Lesson } from '@kikitori/core/model'
import type { Database } from '@kikitori/core/database'

/**
 * Audio types by file extension: one table for both directions (import names a file's type;
 * the cache names a type's file), so an imported file always plays.
 */
export const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  flac: 'audio/flac',
  caf: 'audio/x-caf',
  mp4: 'video/mp4',
}
const EXTENSION_OF: Record<string, string> = {
  ...Object.fromEntries(Object.entries(AUDIO_TYPES).map(([ext, type]) => [type, ext])),
  // Other names browsers give the same formats (web backups carry them).
  'audio/x-m4a': 'm4a',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-aiff': 'aiff',
  'audio/mp3': 'mp3',
}

/** The audio type for a file name, or null if it isn't audio Kikitori can play. */
export const audioTypeOf = (path: string): string | null => AUDIO_TYPES[extname(path).slice(1).toLowerCase()] ?? null

/**
 * Lessons' audio as files (the helper plays files), named by uid in `dir`: written on first
 * use, and pruned of audio no longer in the database.
 */
export function mediaCache(db: Database, dir: string) {
  mkdirSync(dir, { recursive: true })
  return {
    async path(lesson: Pick<Lesson, 'mediaId'>): Promise<string | null> {
      const media = lesson.mediaId ? await db.media.get(lesson.mediaId) : undefined
      if (!media?.uid) return null
      const ext = EXTENSION_OF[media.blob.type] ?? (extname(media.name).slice(1).toLowerCase() || 'audio')
      const path = join(dir, `${media.uid}.${ext}`)
      if (!existsSync(path)) writeFileSync(path, new Uint8Array(await media.blob.arrayBuffer()))
      return path
    },
    async prune() {
      const keep = new Set((await db.media.all()).map((m) => m.uid))
      for (const file of readdirSync(dir)) if (!keep.has(file.replace(/\.[^.]+$/, ''))) rmSync(join(dir, file))
    },
  }
}
