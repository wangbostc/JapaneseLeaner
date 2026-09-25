import { dueAt, isGraduated, type LessonProgress } from '../src/lib/schedule'
import type { Env } from './env'

/**
 * Web Push without a payload: the push only wakes the service worker, which checks the local
 * schedule and shows the reminder itself. No payload means no message encryption, only the
 * VAPID signature (RFC 8292), which WebCrypto does natively.
 */

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const utf8 = (s: string) => new TextEncoder().encode(s)

/** The `Authorization: vapid t=…, k=…` header for one push service origin. */
export async function vapidAuthorization(endpoint: string, env: Pick<Env, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>, now = Date.now()) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys are not configured')
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(
    utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT ?? 'https://github.com/wangbostc/JapaneseLeaner' })),
  )
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`))
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`
}

export type PushOutcome = 'sent' | 'gone' | 'failed'

export async function sendPush(endpoint: string, env: Env, fetcher: typeof fetch = fetch): Promise<PushOutcome> {
  const res = await fetcher(endpoint, {
    method: 'POST',
    headers: { TTL: String(6 * 3600), Urgency: 'normal', Authorization: await vapidAuthorization(endpoint, env), 'Content-Length': '0' },
  })
  if (res.status === 404 || res.status === 410) return 'gone' // unsubscribed or expired
  return res.ok ? 'sent' : 'failed'
}

interface LessonRow {
  uid: string
  data: string
}

/** Reviews due now that haven't been pushed yet, from the synced lessons. */
export async function dueReminders(env: Env, now: number): Promise<{ lessonUid: string; round: number }[]> {
  const { results } = await env.DB.prepare("SELECT uid, data FROM records WHERE kind = 'lessons' AND deleted_at IS NULL").all<LessonRow>()
  const sent = await env.DB.prepare('SELECT lesson_uid, round FROM push_sent').all<{ lesson_uid: string; round: number }>()
  const already = new Set(sent.results.map((r) => `${r.lesson_uid}#${r.round}`))
  const due: { lessonUid: string; round: number }[] = []
  for (const row of results) {
    const progress = (JSON.parse(row.data) as { progress: LessonProgress }).progress
    // Reviews only: a lesson never studied isn't a reminder.
    if (progress.roundsDone === 0 || isGraduated(progress)) continue
    const at = dueAt(progress)
    if (at === null || at > now || already.has(`${row.uid}#${progress.roundsDone}`)) continue
    due.push({ lessonUid: row.uid, round: progress.roundsDone })
  }
  return due
}

/** The cron job: one push per subscription when new reviews are due; expired subscriptions are removed. */
export async function sendDueReminders(env: Env, now = Date.now(), fetcher: typeof fetch = fetch) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { due: 0, sent: 0, removed: 0 }
  const due = await dueReminders(env, now)
  if (!due.length) return { due: 0, sent: 0, removed: 0 }
  const { results: subs } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all<{ endpoint: string }>()
  let sent = 0
  let removed = 0
  for (const { endpoint } of subs) {
    const outcome = await sendPush(endpoint, env, fetcher).catch((): PushOutcome => 'failed')
    if (outcome === 'sent') sent++
    if (outcome === 'gone') {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
      removed++
    }
  }
  // Mark as reminded even if no browser is subscribed yet, so a later subscription doesn't get a backlog.
  await env.DB.batch(due.map((d) => env.DB.prepare('INSERT OR IGNORE INTO push_sent (lesson_uid, round, sent_at) VALUES (?, ?, ?)').bind(d.lessonUid, d.round, now)))
  return { due: due.length, sent, removed }
}

/** Accepts a PushSubscription (JSON) from an authenticated device. */
export async function subscribe(env: Env, deviceId: string, body: Record<string, unknown> | null, now = Date.now()): Promise<Response> {
  const endpoint = body?.endpoint
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return Response.json({ error: 'endpoint must be an https URL' }, { status: 400 })
  await env.DB.prepare('INSERT INTO push_subscriptions (endpoint, device_id, created_at) VALUES (?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET device_id = excluded.device_id')
    .bind(endpoint, deviceId, now)
    .run()
  return Response.json({ subscribed: true }, { status: 201 })
}
