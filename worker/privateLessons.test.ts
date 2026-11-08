import { afterEach, describe, expect, it } from 'vitest'
import { handleApi } from './index'
import { PRIVATE_LESSONS_KEY } from './privateLessons'
import { testEnv } from './testEnv'
import type { Env } from './env'

let dispose: (() => Promise<void>) | null = null
afterEach(async () => {
  await dispose?.()
  dispose = null
})

async function setup(extra: Partial<Env> = {}) {
  const t = await testEnv({ SETUP_CODE: 'private-test-setup-code', ...extra })
  dispose = t.dispose
  const reg = await handleApi(
    new Request('https://k.test/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupCode: 'private-test-setup-code', name: 't' }) }),
    t.env,
  )
  const { token } = (await reg.json()) as { token: string }
  const get = (auth = true) => handleApi(new Request('https://k.test/api/private-lessons', { headers: auth ? { Authorization: `Bearer ${token}` } : {} }), t.env)
  return { env: t.env, get }
}

const doc = { title: 'Test book L3 会話', book: 'Test book', chapter: 3, lines: [{ ja: 'おはよう。', en: 'Morning.' }] }

describe('/api/private-lessons', () => {
  it("doesn't exist unless the server turns it on", async () => {
    // Explicitly off: testEnv also reads a developer's .dev.vars, which may turn it on.
    const { env, get } = await setup({ PRIVATE_LESSONS: undefined })
    await env.FILES.put(PRIVATE_LESSONS_KEY, JSON.stringify({ docs: [doc] }))
    expect((await get()).status).toBe(404)
  })

  it('needs a connected device', async () => {
    const { get } = await setup({ PRIVATE_LESSONS: '1' })
    expect((await get(false)).status).toBe(401)
  })

  it('serves what was uploaded, and nothing before that', async () => {
    const { env, get } = await setup({ PRIVATE_LESSONS: '1' })
    expect(await (await get()).json()).toEqual({ docs: [] })
    await env.FILES.put(PRIVATE_LESSONS_KEY, JSON.stringify({ docs: [doc] }))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ docs: [doc] })
  })
})
