import { markSyncApply, type Deletion, type Flashcard, type KikitoriDB, type Lesson, type PracticeLog } from './db'
import { emptyBatch, type SyncBatch, type SyncRequest, type SyncResponse, type WireCard, type WireLesson, type WireLog, type WireMedia } from './syncWire'

/** Talks to the API: `path` like "/api/sync"; the caller adds auth. */
export type Api = (path: string, init?: RequestInit) => Promise<Response>

export interface SyncState {
  /** Last server sequence applied here. */
  since: number
  /** Local changes newer than this (device clock) haven't been pushed yet. */
  pushedAt: number
  /** Media uids whose bytes the server already has. */
  uploaded: string[]
  /** Media records seen from the server whose bytes weren't available yet. */
  pendingDownloads: WireMedia[]
}

export const initialSyncState = (): SyncState => ({ since: 0, pushedAt: 0, uploaded: [], pendingDownloads: [] })

export interface SyncResult {
  pushed: number
  pulled: number
  state: SyncState
}

/** Records per kind per request, under the server's limit. */
const CHUNK = 1000

const toIso = (d: Date | string | undefined) => (d === undefined ? undefined : new Date(d).toISOString())

function toWireLesson(l: Lesson, mediaUidById: Map<number, string>): WireLesson {
  return {
    uid: l.uid!,
    updatedAt: l.updatedAt!,
    title: l.title,
    level: l.level,
    sentences: l.sentences,
    // Lessons made before mediaUid existed only know their local mediaId.
    mediaUid: l.mediaUid ?? (l.mediaId !== undefined ? mediaUidById.get(l.mediaId) : undefined) ?? null,
    progress: l.progress,
    resume: l.resume,
    hard: l.hard,
    createdAt: l.createdAt,
    builtIn: l.builtIn,
  }
}

function toWireCard(c: Flashcard, lessonUid: string): WireCard {
  return {
    uid: c.uid!,
    updatedAt: c.updatedAt!,
    lessonUid,
    kind: c.kind,
    front: c.front,
    reading: c.reading,
    context: c.context,
    card: { ...c.card, due: toIso(c.card.due)!, last_review: toIso(c.card.last_review) } as WireCard['card'],
    createdAt: c.createdAt,
  }
}

const fromWireCard = (c: WireCard): Flashcard['card'] =>
  ({ ...c.card, due: new Date(c.card.due), ...(c.card.last_review ? { last_review: new Date(c.card.last_review) } : {}) }) as Flashcard['card']

/** Everything changed locally since the last push, in wire form. */
async function gatherChanges(db: KikitoriDB, state: SyncState): Promise<SyncBatch> {
  // (Each record's updatedAt as gathered is recorded by the caller from the batch.)
  const since = state.pushedAt
  const lessons = await db.lessons.toArray()
  const lessonUid = new Map(lessons.map((l) => [l.id!, l.uid!]))
  const mediaUidById = new Map<number, string>()
  await db.media.each((m) => void mediaUidById.set(m.id!, m.uid!))
  const batch = emptyBatch()
  // syncedVersion: a record already exchanged at this version (e.g. pulled with another device's
  // clock ahead of ours, so still "newer" than our cursor) has nothing to push.
  const unsynced = (r: { updatedAt?: number; syncedVersion?: number }) => r.updatedAt! > since && r.updatedAt !== r.syncedVersion
  batch.lessons = lessons.filter(unsynced).map((l) => toWireLesson(l, mediaUidById))
  batch.cards = (await db.cards.where('updatedAt').above(since).toArray())
    .filter(unsynced)
    .filter((c) => lessonUid.has(c.lessonId))
    .map((c) => toWireCard(c, lessonUid.get(c.lessonId)!))
  batch.logs = (await db.logs.where('updatedAt').above(since).toArray()).map(
    (l): WireLog => ({ uid: l.uid!, updatedAt: l.updatedAt!, lessonUid: l.lessonUid ?? null, step: l.step, mode: l.mode, ms: l.ms, at: l.at }),
  )
  batch.media = (await db.media.where('updatedAt').above(since).toArray()).map((m) => ({
    uid: m.uid!,
    updatedAt: m.updatedAt!,
    name: m.name,
    type: m.blob.type,
    size: m.blob.size,
  }))
  batch.words = (await db.words.toArray()).filter((w) => w.firstSeen > since)
  batch.deletions = (await db.deletions.toArray()).filter((d: Deletion) => d.at > since).map(({ uid, table, at }) => ({ uid, table, at }))
  return batch
}

/** Splits a batch so no request carries more than CHUNK records of a kind. */
function* chunks(batch: SyncBatch): Generator<SyncBatch> {
  const keys = Object.keys(batch) as (keyof SyncBatch)[]
  const rounds = Math.max(1, ...keys.map((k) => Math.ceil(batch[k].length / CHUNK)))
  for (let i = 0; i < rounds; i++) {
    const part = emptyBatch()
    for (const k of keys) (part[k] as unknown[]) = batch[k].slice(i * CHUNK, (i + 1) * CHUNK)
    yield part
  }
}

/**
 * Writes the server's changes locally with the server's updatedAt (so they aren't pushed back
 * as new edits), mapping uids to this device's ids. A record edited here since it was gathered
 * for this push is left alone: it goes up on the next sync. (Comparing against the wall clock
 * instead would misfire when another device's clock is ahead.)
 */
async function applyChanges(db: KikitoriDB, changes: SyncBatch, editedSince: (row: { uid?: string; updatedAt?: number; syncedVersion?: number }) => boolean): Promise<WireMedia[]> {
  const needBytes: WireMedia[] = []
  await db.transaction('rw', [db.lessons, db.media, db.cards, db.logs, db.words, db.deletions], async (tx) => {
    markSyncApply(tx)
    // Local tombstones for records the server sends alive: a deletion newer than the incoming
    // version (e.g. made during this sync) stands and goes up next time; an older one is
    // superseded (edited elsewhere after the delete), so drop it and the record can be deleted again.
    const alive = [...changes.lessons, ...changes.cards].map((r) => r.uid)
    const tombs = new Map((alive.length ? await db.deletions.where('uid').anyOf(alive).toArray() : []).map((t) => [t.uid, t]))
    const deletedHere = async (w: { uid: string; updatedAt: number }) => {
      const t = tombs.get(w.uid)
      if (!t) return false
      if (t.at > w.updatedAt) return true
      await db.deletions.delete(t.id!)
      return false
    }
    for (const m of changes.media) if (!(await db.media.where('uid').equals(m.uid).first())) needBytes.push(m)

    for (const w of changes.lessons) {
      if (await deletedHere(w)) continue
      const local = await db.lessons.where('uid').equals(w.uid).first()
      if (local && editedSince(local)) continue
      const media = w.mediaUid ? await db.media.where('uid').equals(w.mediaUid).first() : undefined
      const row: Lesson = {
        ...(local ?? {}),
        uid: w.uid,
        updatedAt: w.updatedAt,
        syncedVersion: w.updatedAt,
        title: w.title,
        level: w.level,
        sentences: w.sentences,
        mediaUid: w.mediaUid ?? undefined,
        mediaId: media?.id,
        progress: w.progress,
        resume: w.resume,
        hard: w.hard,
        createdAt: w.createdAt,
        builtIn: w.builtIn,
      }
      if (local) await db.lessons.put({ ...row, id: local.id })
      else await db.lessons.add(row)
    }

    const lessonId = new Map((await db.lessons.toArray()).map((l) => [l.uid!, l.id!]))
    for (const w of changes.cards) {
      const id = lessonId.get(w.lessonUid)
      if (id === undefined) continue // its lesson is gone here
      if (await deletedHere(w)) continue
      const local = await db.cards.where('uid').equals(w.uid).first()
      if (local && editedSince(local)) continue
      const row: Flashcard = { uid: w.uid, updatedAt: w.updatedAt, syncedVersion: w.updatedAt, lessonId: id, kind: w.kind, front: w.front, reading: w.reading, context: w.context, card: fromWireCard(w), createdAt: w.createdAt }
      if (local) await db.cards.put({ ...row, id: local.id })
      else await db.cards.add(row)
    }

    for (const w of changes.logs) {
      if (await db.logs.where('uid').equals(w.uid).first()) continue
      const log: PracticeLog = { uid: w.uid, updatedAt: w.updatedAt, lessonUid: w.lessonUid, lessonId: (w.lessonUid && lessonId.get(w.lessonUid)) || 0, step: w.step, mode: w.mode, ms: w.ms, at: w.at }
      await db.logs.add(log)
    }

    for (const w of changes.words) {
      const local = await db.words.get(w.lemma)
      if (!local) await db.words.add(w)
      else if (w.firstSeen < local.firstSeen) await db.words.put(w)
    }

    for (const d of changes.deletions) {
      const table = d.table === 'lessons' ? db.lessons : d.table === 'cards' ? db.cards : db.media
      const local = await (table as typeof db.lessons).where('uid').equals(d.uid).first()
      if (!local || local.updatedAt! > d.at) continue
      if (d.table === 'lessons') await db.cards.where('lessonId').equals(local.id!).delete()
      await table.delete(local.id!)
    }
  })
  return needBytes
}

/** Records that the server now has these versions (unless the record changed again meanwhile). */
async function markPushed(db: KikitoriDB, part: SyncBatch) {
  await db.transaction('rw', [db.lessons, db.cards], async (tx) => {
    markSyncApply(tx)
    for (const [table, list] of [
      [db.lessons, part.lessons],
      [db.cards, part.cards],
    ] as const) {
      for (const r of list) {
        await (table as typeof db.lessons)
          .where('uid')
          .equals(r.uid)
          .filter((row) => row.updatedAt === r.updatedAt)
          .modify({ syncedVersion: r.updatedAt })
      }
    }
  })
}

/** Downloads audio bytes and links them to lessons waiting for them; returns what's still missing. */
async function downloadMedia(db: KikitoriDB, api: Api, wanted: WireMedia[]): Promise<WireMedia[]> {
  const missing: WireMedia[] = []
  for (const m of wanted) {
    if (await db.media.where('uid').equals(m.uid).first()) continue
    const res = await api(`/api/media/${encodeURIComponent(m.uid)}`)
    if (!res.ok) {
      missing.push(m)
      continue
    }
    const blob = await res.blob()
    await db.transaction('rw', [db.media, db.lessons], async () => {
      const id = (await db.media.add({ uid: m.uid, updatedAt: m.updatedAt, name: m.name, blob: new Blob([blob], { type: m.type }) })) as number
      // mediaId is local-only, so linking doesn't count as an edit (see the updating hook).
      await db.lessons.filter((l) => l.mediaUid === m.uid).modify({ mediaId: id })
    })
  }
  return missing
}

/** Uploads the bytes of local audio the server doesn't have yet. */
async function uploadMedia(db: KikitoriDB, api: Api, uploaded: Set<string>) {
  for (const m of await db.media.toArray()) {
    if (!m.uid || uploaded.has(m.uid)) continue
    const res = await api(`/api/media/${encodeURIComponent(m.uid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': m.blob.type || 'application/octet-stream', 'Content-Length': String(m.blob.size) },
      body: m.blob,
    })
    if (res.ok) uploaded.add(m.uid)
  }
}

export class SyncError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** One full sync: push local changes, apply the server's, then move audio both ways. */
export interface SyncHooks {
  /** Called true/false around writing server changes locally (so the app can ignore those writes). */
  applying?: (on: boolean) => void
}

export async function syncOnce(db: KikitoriDB, api: Api, state: SyncState, now = () => Date.now(), hooks: SyncHooks = {}): Promise<SyncResult> {
  const startedAt = now()
  const local = await gatherChanges(db, state)
  const gathered = new Map<string, number>([...local.lessons, ...local.cards].map((r) => [r.uid, r.updatedAt]))
  // Has this record changed locally since we last exchanged it? For records in this push, compare
  // with the version gathered; otherwise with the version last synced (the wall-clock cursor would
  // misread records stamped by a device whose clock is ahead).
  const editedSince = (row: { uid?: string; updatedAt?: number; syncedVersion?: number }) => {
    const pushed = gathered.get(row.uid!)
    if (pushed !== undefined) return row.updatedAt! > pushed
    if (row.syncedVersion !== undefined) return row.updatedAt !== row.syncedVersion
    return row.updatedAt! > state.pushedAt
  }
  const pushed = Object.values(local).reduce((n, list) => n + list.length, 0)
  let since = state.since
  let pulled = 0
  const needBytes: WireMedia[] = [...state.pendingDownloads]
  for (const part of chunks(local)) {
    const body: SyncRequest = { since, ...part }
    const res = await api('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new SyncError(`sync failed: ${res.status}`, res.status)
    const reply = (await res.json()) as SyncResponse
    pulled += Object.entries(reply).reduce((n, [k, v]) => (k === 'seq' ? n : n + (v as unknown[]).length), 0)
    hooks.applying?.(true)
    try {
      await markPushed(db, part)
      needBytes.push(...(await applyChanges(db, reply, editedSince)))
    } finally {
      hooks.applying?.(false)
    }
    since = reply.seq
  }
  const uploaded = new Set(state.uploaded)
  await uploadMedia(db, api, uploaded)
  hooks.applying?.(true)
  let pendingDownloads: WireMedia[]
  try {
    pendingDownloads = await downloadMedia(db, api, needBytes)
  } finally {
    hooks.applying?.(false)
  }
  return { pushed, pulled, state: { since, pushedAt: startedAt, uploaded: [...uploaded], pendingDownloads } }
}
