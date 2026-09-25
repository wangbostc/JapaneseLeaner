import { afterEach, describe, expect, it } from 'vitest'
import { sendDueReminders, vapidAuthorization } from './push'
import { testEnv } from './testEnv'

let dispose: (() => Promise<void>) | null = null
afterEach(async () => {
  await dispose?.()
  dispose = null
})

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  return {
    VAPID_PUBLIC_KEY: btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    VAPID_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    publicKey: pair.publicKey,
  }
}

const H = 3_600_000
const T0 = Date.UTC(2026, 8, 25, 9)

describe('VAPID', () => {
  it('signs a JWT for the push service origin that verifies with the public key', async () => {
    const k = await vapidKeys()
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...k, VAPID_SUBJECT: 'mailto:me@example.com' }, T0)
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!
    expect(key).toBe(k.VAPID_PUBLIC_KEY)
    const [h, c, sig] = token.split('.')
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: T0 / 1000 + 12 * 3600, sub: 'mailto:me@example.com' })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, b64urlDecode(sig), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
  })
})

describe('sendDueReminders', () => {
  async function setup() {
    const k = await vapidKeys()
    const t = await testEnv({ VAPID_PUBLIC_KEY: k.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: k.VAPID_PRIVATE_KEY })
    dispose = t.dispose
    const lesson = (uid: string, roundsDone: number, lastCompletedAt: number | null) =>
      t.env.DB.prepare("INSERT INTO records (uid, kind, data, updated_at, seq) VALUES (?, 'lessons', ?, 0, 1)").bind(uid, JSON.stringify({ uid, progress: { roundsDone, lastCompletedAt } })).run()
    const sub = (endpoint: string) => t.env.DB.prepare("INSERT INTO push_subscriptions (endpoint, device_id, created_at) VALUES (?, 'd', 0)").bind(endpoint).run()
    return { env: t.env, lesson, sub }
  }

  it('pushes once per due review round to every subscription, and drops expired ones', async () => {
    const { env, lesson, sub } = await setup()
    await lesson('due', 1, T0 - 7 * H) // review 1 due an hour ago
    await lesson('later', 1, T0 - 1 * H) // due in 5h
    await lesson('new', 0, null) // never studied: not a reminder
    await sub('https://push.example/alive')
    await sub('https://push.example/gone')
    const calls: { url: string; auth: string | null; body: unknown }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('Authorization'), body: init.body })
      return new Response(null, { status: url.endsWith('gone') ? 410 : 201 })
    }) as typeof fetch

    expect(await sendDueReminders(env, T0, fetcher)).toEqual({ due: 1, sent: 1, removed: 1 })
    expect(calls.map((c) => c.url).sort()).toEqual(['https://push.example/alive', 'https://push.example/gone'])
    expect(calls[0].auth).toMatch(/^vapid t=.+, k=.+$/)
    expect(calls[0].body).toBeUndefined() // no payload
    expect((await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all()).results).toEqual([{ endpoint: 'https://push.example/alive' }])

    // The same review isn't pushed again on the next run.
    calls.length = 0
    expect(await sendDueReminders(env, T0 + 15 * 60_000, fetcher)).toEqual({ due: 0, sent: 0, removed: 0 })
    expect(calls).toEqual([])

    // The next round of the same lesson is a new reminder.
    await env.DB.prepare("UPDATE records SET data = ? WHERE uid = 'due'").bind(JSON.stringify({ progress: { roundsDone: 2, lastCompletedAt: T0 - 25 * H } })).run()
    expect((await sendDueReminders(env, T0, fetcher)).due).toBe(1)
  })

  it('does nothing without VAPID keys', async () => {
    const t = await testEnv()
    dispose = t.dispose
    expect(await sendDueReminders(t.env, T0, (() => {
      throw new Error('should not push')
    }) as unknown as typeof fetch)).toEqual({ due: 0, sent: 0, removed: 0 })
  })
})
