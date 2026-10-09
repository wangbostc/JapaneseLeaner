import { basename } from 'node:path'
import type { ReadAudio } from '@kikitori/core/privateLessons'
import { audioTypeOf } from './media'

/**
 * The learner's private lessons (kikitori.privateLessons in the local MongoDB; see
 * @kikitori/core/privateLessons), or null when MongoDB isn't there: they're an extra, and the app
 * runs the same without them. KIKITORI_MONGO_URL and KIKITORI_MONGO_DB point elsewhere.
 */
export async function readPrivateLessons(
  url = process.env.KIKITORI_MONGO_URL ?? 'mongodb://127.0.0.1:27017',
  database = process.env.KIKITORI_MONGO_DB ?? 'kikitori',
): Promise<unknown[] | null> {
  try {
    const { MongoClient } = await import('mongodb')
    // Quick to give up: a computer without MongoDB shouldn't wait on it.
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 1500 })
    try {
      await client.connect()
      return await client.db(database).collection('privateLessons').find().sort({ _id: 1 }).toArray()
    } finally {
      await client.close()
    }
  } catch {
    return null
  }
}

/** A private lesson's audio file: read whole, typed by its extension; null if it can't be. */
export const readAudioFile: ReadAudio = async (path) => {
  const type = audioTypeOf(path)
  const file = Bun.file(path)
  if (!type || !(await file.exists())) return null
  return { blob: new Blob([await file.arrayBuffer()], { type }), name: basename(path), stamp: `${file.size}:${file.lastModified}` }
}
