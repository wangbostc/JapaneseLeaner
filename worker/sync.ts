import { mergeCard, mergeLesson, survivesDeletion } from '../src/lib/merge'
import type { SyncBatch, SyncRequest, SyncResponse, WireCard, WireDeletion, WireLesson } from '../src/lib/syncWire'
import type { Env } from './env'

type Kind = 'lessons' | 'cards' | 'logs' | 'media'
interface Row {
  uid: string
  kind: Kind
  data: string | null
  updated_at: number
  deleted_at: number | null
}

/** Records per kind per request; a first sync of a big library is split by the client. */
export const MAX_PER_KIND = 2000
const KINDS: Kind[] = ['lessons', 'cards', 'logs', 'media']
const SEQ = "(SELECT value FROM meta WHERE key = 'seq')"

export class BadRequest extends Error {}

/** Checks the request's shape; record contents are the client's own data and stored as sent. */
export function parseSyncRequest(body: unknown): SyncRequest {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be an object')
  const b = body as Record<string, unknown>
  if (typeof b.since !== 'number' || !Number.isInteger(b.since) || b.since < 0) throw new BadRequest('since must be a non-negative integer')
  for (const key of [...KINDS, 'words', 'deletions']) {
    const list = b[key] ?? []
    if (!Array.isArray(list)) throw new BadRequest(`${key} must be an array`)
    if (list.length > MAX_PER_KIND) throw new BadRequest(`too many ${key} (max ${MAX_PER_KIND})`)
    for (const item of list) {
      const r = item as Record<string, unknown>
      if (key === 'words') {
        if (typeof r?.lemma !== 'string' || typeof r.firstSeen !== 'number') throw new BadRequest('bad word')
      } else if (key === 'deletions') {
        if (typeof r?.uid !== 'string' || typeof r.at !== 'number' || !['lessons', 'media', 'cards'].includes(r.table as string)) throw new BadRequest('bad deletion')
      } else if (typeof r?.uid !== 'string' || typeof r.updatedAt !== 'number') {
        throw new BadRequest(`bad ${key} record`)
      }
    }
    b[key] = list
  }
  return b as unknown as SyncRequest
}

async function loadRows(env: Env, uids: string[]): Promise<Map<string, Row>> {
  const rows = new Map<string, Row>()
  // D1 caps bound parameters per statement; query in slices.
  for (let i = 0; i < uids.length; i += 90) {
    const slice = uids.slice(i, i + 90)
    const { results } = await env.DB.prepare(`SELECT uid, kind, data, updated_at, deleted_at FROM records WHERE uid IN (${slice.map(() => '?').join(',')})`)
      .bind(...slice)
      .all<Row>()
    for (const r of results) rows.set(r.uid, r)
  }
  return rows
}

/**
 * Merges a device's changes into the server copy, then returns everything newer than the
 * device's `since`. All writes of one request share one new sequence number, allocated inside
 * the same atomic batch, so a pull never skips a write that commits later.
 */
export async function sync(env: Env, req: SyncRequest): Promise<SyncResponse> {
  const incoming = [...req.lessons, ...req.cards, ...req.logs, ...req.media].map((r) => r.uid)
  const existing = await loadRows(env, [...incoming, ...req.deletions.map((d) => d.uid)])
  const writes: D1PreparedStatement[] = []
  const put = (kind: Kind, uid: string, data: unknown, updatedAt: number) =>
    writes.push(
      env.DB.prepare(
        `INSERT INTO records (uid, kind, data, updated_at, deleted_at, seq) VALUES (?, ?, ?, ?, NULL, ${SEQ})
         ON CONFLICT (uid) DO UPDATE SET kind = excluded.kind, data = excluded.data, updated_at = excluded.updated_at, deleted_at = NULL, seq = excluded.seq`,
      ).bind(uid, kind, JSON.stringify(data), updatedAt),
    )
  const removedMedia: string[] = []

  for (const kind of KINDS) {
    for (const rec of req[kind] as { uid: string; updatedAt: number }[]) {
      const row = existing.get(rec.uid)
      if (row?.deleted_at != null) {
        if (survivesDeletion(rec, row.deleted_at)) put(kind, rec.uid, rec, rec.updatedAt)
        continue
      }
      if (!row) {
        put(kind, rec.uid, rec, rec.updatedAt)
        continue
      }
      // Logs and media are immutable once written.
      if (kind === 'logs' || kind === 'media') continue
      const current = JSON.parse(row.data!)
      const merged = kind === 'lessons' ? mergeLesson(current as WireLesson, rec as WireLesson) : mergeCard(current as WireCard, rec as WireCard)
      if (JSON.stringify(merged) !== row.data) put(kind, rec.uid, merged, merged.updatedAt)
    }
  }

  for (const del of req.deletions as WireDeletion[]) {
    const row = existing.get(del.uid)
    if (row && (row.deleted_at != null || survivesDeletion({ updatedAt: row.updated_at }, del.at))) continue
    writes.push(
      env.DB.prepare(
        `INSERT INTO records (uid, kind, data, updated_at, deleted_at, seq) VALUES (?, ?, NULL, ?, ?, ${SEQ})
         ON CONFLICT (uid) DO UPDATE SET data = NULL, deleted_at = excluded.deleted_at, seq = excluded.seq`,
      ).bind(del.uid, del.table, del.at, del.at),
    )
    if (del.table === 'media') removedMedia.push(del.uid)
  }

  for (const w of req.words) {
    writes.push(
      env.DB.prepare(
        `INSERT INTO words (lemma, first_seen, seq) VALUES (?, ?, ${SEQ})
         ON CONFLICT (lemma) DO UPDATE SET first_seen = MIN(first_seen, excluded.first_seen), seq = CASE WHEN excluded.first_seen < first_seen THEN excluded.seq ELSE seq END`,
      ).bind(w.lemma, w.firstSeen),
    )
  }

  if (writes.length) await env.DB.batch([env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key = 'seq'"), ...writes])
  if (removedMedia.length) await Promise.all(removedMedia.map((uid) => env.FILES.delete(`media/${uid}`)))

  return { seq: await currentSeq(env), ...(await changesSince(env, req.since)) }
}

async function currentSeq(env: Env): Promise<number> {
  return (await env.DB.prepare("SELECT value FROM meta WHERE key = 'seq'").first<{ value: number }>())!.value
}

async function changesSince(env: Env, since: number): Promise<SyncBatch> {
  const out: SyncBatch = { lessons: [], cards: [], logs: [], media: [], words: [], deletions: [] }
  const { results } = await env.DB.prepare('SELECT uid, kind, data, updated_at, deleted_at FROM records WHERE seq > ? ORDER BY seq').bind(since).all<Row>()
  for (const r of results) {
    if (r.deleted_at != null) {
      if (r.kind !== 'logs') out.deletions.push({ uid: r.uid, table: r.kind, at: r.deleted_at })
    } else (out[r.kind] as unknown[]).push(JSON.parse(r.data!))
  }
  const words = await env.DB.prepare('SELECT lemma, first_seen FROM words WHERE seq > ?').bind(since).all<{ lemma: string; first_seen: number }>()
  out.words = words.results.map((w) => ({ lemma: w.lemma, firstSeen: w.first_seen }))
  return out
}

/**
 * Largest audio file accepted (bytes). Cloudflare caps request bodies at 100 MB on the free
 * plan; an hour of 128 kbps MP3 is about 58 MB.
 */
export const MAX_MEDIA_BYTES = 95 * 1024 * 1024

/** Stores the bytes for a media record the device has already synced. */
export async function putMedia(env: Env, uid: string, request: Request): Promise<Response> {
  const row = await env.DB.prepare("SELECT deleted_at FROM records WHERE uid = ? AND kind = 'media'").bind(uid).first<{ deleted_at: number | null }>()
  if (!row || row.deleted_at != null) return Response.json({ error: 'sync the media record first' }, { status: 409 })
  const length = Number(request.headers.get('Content-Length') ?? NaN)
  if (!Number.isFinite(length) || length > MAX_MEDIA_BYTES) return Response.json({ error: 'missing or too large Content-Length' }, { status: 413 })
  const contentType = request.headers.get('Content-Type') ?? 'application/octet-stream'
  // Stream to R2 without buffering (Workers have 128 MB of memory): R2 needs a stream of known
  // length, which FixedLengthStream provides. Node (the tests) lacks it, so buffer there.
  let body: ReadableStream | ArrayBuffer
  if (typeof FixedLengthStream === 'function' && request.body) {
    const { readable, writable } = new FixedLengthStream(length)
    void request.body.pipeTo(writable)
    body = readable
  } else {
    body = await request.arrayBuffer()
  }
  await env.FILES.put(`media/${uid}`, body, { httpMetadata: { contentType } })
  return Response.json({ stored: uid }, { status: 201 })
}

export async function getMedia(env: Env, uid: string): Promise<Response> {
  const object = await env.FILES.get(`media/${uid}`)
  if (!object) return Response.json({ error: 'not uploaded yet' }, { status: 404 })
  return new Response(object.body, {
    headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' },
  })
}
