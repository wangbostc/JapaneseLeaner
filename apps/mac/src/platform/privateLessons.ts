import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ReadAudio } from '@kikitori/core/privateLessons'
import { audioTypeOf } from './media'

/**
 * The learner's private lessons (kikitori.privateLessons in the local MongoDB; see
 * @kikitori/core/privateLessons), or why they couldn't be read: they're an extra, and the app
 * runs the same without them. KIKITORI_MONGO_URL and KIKITORI_MONGO_DB point elsewhere.
 */
export async function readPrivateLessons(
  url = process.env.KIKITORI_MONGO_URL ?? 'mongodb://127.0.0.1:27017',
  database = process.env.KIKITORI_MONGO_DB ?? 'kikitori',
): Promise<{ docs: unknown[] } | { error: string }> {
  try {
    const { MongoClient } = await import('mongodb')
    // Quick to give up: a computer without MongoDB shouldn't wait on it.
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 1500 })
    try {
      await client.connect()
      return { docs: await client.db(database).collection('privateLessons').find().sort({ _id: 1 }).toArray() }
    } finally {
      await client.close()
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Private lessons' audio files: a stat for the stamp, the bytes only when needed. Anything that
 * goes wrong (missing, not audio, not allowed: ~/Documents and the like need the app to have
 * access) gives null, and that lesson is read aloud.
 */
export const audioFiles: ReadAudio = {
  async stamp(path) {
    try {
      const s = await stat(path)
      return audioTypeOf(path) && s.isFile() ? `${s.size}:${s.mtimeMs}` : null
    } catch {
      return null
    }
  },
  async read(path) {
    try {
      const type = audioTypeOf(path)
      if (!type) return null
      return { blob: new Blob([await Bun.file(path).arrayBuffer()], { type }), name: basename(path) }
    } catch {
      return null
    }
  },
}
