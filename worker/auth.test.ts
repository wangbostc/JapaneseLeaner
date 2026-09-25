import { afterEach, describe, expect, it } from 'vitest'
import { MAX_FAILED_ATTEMPTS } from './auth'
import type { Env } from './env'
import { handleApi } from './index'
import { testEnv } from './testEnv'

const SETUP = 'correct horse battery'
let dispose: (() => Promise<void>) | null = null
afterEach(async () => {
  await dispose?.()
  dispose = null
})

async function setup(extra: Partial<Env> = { SETUP_CODE: SETUP }) {
  const t = await testEnv(extra)
  dispose = t.dispose
  const call = (method: string, path: string, opts: { body?: unknown; token?: string; ip?: string } = {}) =>
    handleApi(
      new Request(`https://kikitori.test${path}`, {
        method,
        headers: {
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          'CF-Connecting-IP': opts.ip ?? '203.0.113.7',
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }),
      t.env,
    )
  return { env: t.env, call }
}

describe('device auth', () => {
  it('registers a device with the setup code and authenticates its token', async () => {
    const { env, call } = await setup()
    const res = await call('POST', '/api/devices', { body: { setupCode: SETUP, name: 'iPhone' } })
    expect(res.status).toBe(201)
    const { token, device } = (await res.json()) as { token: string; device: { id: string; name: string } }
    expect(device.name).toBe('iPhone')
    expect(token.length).toBeGreaterThanOrEqual(40)

    const me = await call('GET', '/api/me', { token })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ device })

    // Only the hash is stored.
    const row = await env.DB.prepare('SELECT token_hash FROM devices').first<{ token_hash: string }>()
    expect(row!.token_hash).not.toContain(token)
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects missing, wrong and revoked tokens', async () => {
    const { call } = await setup()
    expect((await call('GET', '/api/me')).status).toBe(401)
    expect((await call('GET', '/api/me', { token: 'nope' })).status).toBe(401)
    const { token, device } = (await (await call('POST', '/api/devices', { body: { setupCode: SETUP, name: 'Mac' } })).json()) as {
      token: string
      device: { id: string }
    }
    expect((await call('DELETE', `/api/devices/${device.id}`, { token })).status).toBe(200)
    expect((await call('GET', '/api/me', { token })).status).toBe(401)
  })

  it('refuses a wrong setup code and throttles guessing per IP', async () => {
    const { call } = await setup()
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      expect((await call('POST', '/api/devices', { body: { setupCode: 'wrong-guess-123', name: 'x' } })).status).toBe(403)
    }
    // Even the right code is refused once the limit is hit, from that IP.
    expect((await call('POST', '/api/devices', { body: { setupCode: SETUP, name: 'x' } })).status).toBe(429)
    expect((await call('POST', '/api/devices', { body: { setupCode: SETUP, name: 'x' }, ip: '198.51.100.2' })).status).toBe(201)
  })

  it('stays closed when no (or a too-short) setup code is configured', async () => {
    const { call } = await setup({ SETUP_CODE: 'short' })
    expect((await call('POST', '/api/devices', { body: { setupCode: 'short', name: 'x' } })).status).toBe(503)
  })

  it('serves health without auth and 404s unknown routes', async () => {
    const { call } = await setup()
    expect(await (await call('GET', '/api/health')).json()).toEqual({ ok: true })
    const { token } = (await (await call('POST', '/api/devices', { body: { setupCode: SETUP, name: 'x' } })).json()) as { token: string }
    expect((await call('GET', '/api/nope', { token })).status).toBe(404)
  })
})
