import type { Env } from './env'

export const MIN_SETUP_CODE_LENGTH = 12
/** Failed setup attempts allowed per IP per hour. */
export const MAX_FAILED_ATTEMPTS = 10
const HOUR = 3_600_000

export interface Device {
  id: string
  name: string
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Compares two strings without leaking how much of them matched through timing. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i)
  return diff === 0
}

export type RegisterResult =
  | { ok: true; device: Device; token: string }
  | { ok: false; status: 400 | 403 | 429 | 503; error: string }

/** Exchanges the setup code for a device token. The token is returned once and never stored in clear. */
export async function registerDevice(env: Env, ip: string, setupCode: unknown, name: unknown, now = Date.now()): Promise<RegisterResult> {
  if (!env.SETUP_CODE || env.SETUP_CODE.length < MIN_SETUP_CODE_LENGTH) {
    return { ok: false, status: 503, error: 'server setup code is not configured' }
  }
  if (typeof setupCode !== 'string' || typeof name !== 'string' || !name.trim() || name.length > 80) {
    return { ok: false, status: 400, error: 'setupCode and name are required' }
  }
  const failures = await env.DB.prepare('SELECT COUNT(*) AS n FROM setup_attempts WHERE ip = ? AND at > ?')
    .bind(ip, now - HOUR)
    .first<{ n: number }>()
  if ((failures?.n ?? 0) >= MAX_FAILED_ATTEMPTS) return { ok: false, status: 429, error: 'too many attempts; try again later' }
  if (!(await safeEqual(setupCode, env.SETUP_CODE))) {
    await env.DB.prepare('INSERT INTO setup_attempts (ip, at) VALUES (?, ?)').bind(ip, now).run()
    return { ok: false, status: 403, error: 'wrong setup code' }
  }
  const device = { id: crypto.randomUUID(), name: name.trim() }
  const token = randomToken()
  await env.DB.prepare('INSERT INTO devices (id, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(device.id, device.name, await sha256(token), now, now)
    .run()
  return { ok: true, device, token }
}

/** The device behind a `Bearer` token, or null. */
export async function authenticate(env: Env, request: Request, now = Date.now()): Promise<Device | null> {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')
  if (!match) return null
  const row = await env.DB.prepare('SELECT id, name, last_seen_at FROM devices WHERE token_hash = ?')
    .bind(await sha256(match[1]))
    .first<{ id: string; name: string; last_seen_at: number }>()
  if (!row) return null
  // Refresh "last seen" at most every few minutes, not on every request.
  if (now - row.last_seen_at > 5 * 60_000) await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, row.id).run()
  return { id: row.id, name: row.name }
}
