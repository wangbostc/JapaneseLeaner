import type { Flashcard, KikitoriDB, KnownWord, Lesson, PracticeLog } from './db'

export const BACKUP_FORMAT = 'kikitori-backup'
export const BACKUP_VERSION = 1

interface MediaDump {
  id: number
  name: string
  type: string
  base64: string
}

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  lessons: Lesson[]
  media: MediaDump[]
  cards: Flashcard[]
  logs: PracticeLog[]
  words: KnownWord[]
  settings?: unknown
}

const CHUNK = 0x8000

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/**
 * Everything on this device, audio included, as a JSON file. It's assembled
 * from Blob parts, one per audio file, so no single string holds the whole
 * library (a JS string tops out around 500M characters).
 */
export async function exportBackup(db: KikitoriDB, settings?: unknown, now = Date.now()): Promise<Blob> {
  const rest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    lessons: await db.lessons.toArray(),
    cards: await db.cards.toArray(),
    logs: await db.logs.toArray(),
    words: await db.words.toArray(),
    settings,
  }
  const parts: BlobPart[] = [JSON.stringify(rest).slice(0, -1), ',"media":[']
  const media = await db.media.toArray()
  for (const [i, m] of media.entries()) {
    const dump: MediaDump = { id: m.id!, name: m.name, type: m.blob.type, base64: await blobToBase64(m.blob) }
    parts.push(i ? ',' : '', JSON.stringify(dump))
  }
  parts.push(']}')
  return new Blob(parts, { type: 'application/json' })
}

export class BackupError extends Error {}

/** JSON turns FSRS dates into strings; bring them back so scheduling and the due index work. */
function reviveCard(c: Flashcard): Flashcard {
  const card = { ...c.card, due: new Date(c.card.due) }
  if (c.card.last_review) card.last_review = new Date(c.card.last_review)
  return { ...c, card }
}

export function parseBackup(json: string): Backup {
  let data: Partial<Backup>
  try {
    data = JSON.parse(json)
  } catch {
    throw new BackupError('not a JSON file')
  }
  if (data?.format !== BACKUP_FORMAT) throw new BackupError('not a Kikitori backup')
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) throw new BackupError(`unsupported backup version ${data.version}`)
  for (const key of ['lessons', 'media', 'cards', 'logs', 'words'] as const) {
    if (!Array.isArray(data[key])) throw new BackupError(`backup is missing ${key}`)
  }
  // Check the fields pages rely on, so a malformed file fails here and not mid-render.
  data.lessons!.forEach((l, i) => {
    const ok =
      typeof l?.title === 'string' &&
      Array.isArray(l.sentences) &&
      l.sentences.every((x) => typeof x?.text === 'string') &&
      Array.isArray(l.hard) &&
      typeof l.progress?.roundsDone === 'number'
    if (!ok) throw new BackupError(`lesson ${i + 1} is malformed`)
  })
  data.cards!.forEach((c, i) => {
    if (typeof c?.front !== 'string' || !c.card || Number.isNaN(new Date(c.card.due).getTime())) throw new BackupError(`card ${i + 1} is malformed`)
  })
  data.media!.forEach((m, i) => {
    if (typeof m?.id !== 'number' || typeof m.base64 !== 'string') throw new BackupError(`audio ${i + 1} is malformed`)
  })
  return data as Backup
}

/** Replaces everything on this device with the backup, atomically. */
export async function restoreBackup(db: KikitoriDB, backup: Backup): Promise<void> {
  const media = backup.media.map((m) => ({ id: m.id, name: m.name, blob: base64ToBlob(m.base64, m.type) }))
  await db.transaction('rw', [db.lessons, db.media, db.cards, db.logs, db.words], async () => {
    await Promise.all([db.lessons.clear(), db.media.clear(), db.cards.clear(), db.logs.clear(), db.words.clear()])
    await db.media.bulkAdd(media)
    await db.lessons.bulkAdd(backup.lessons)
    await db.cards.bulkAdd(backup.cards.map(reviveCard))
    await db.logs.bulkAdd(backup.logs)
    await db.words.bulkAdd(backup.words)
  })
}
