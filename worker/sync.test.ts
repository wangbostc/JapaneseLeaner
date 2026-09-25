import { afterEach, describe, expect, it } from 'vitest'
import { handleApi } from './index'
import { MAX_PER_KIND } from './sync'
import { testEnv } from './testEnv'

let dispose: (() => Promise<void>) | null = null
afterEach(async () => {
  await dispose?.()
  dispose = null
})

async function setup() {
  const t = await testEnv({ SETUP_CODE: 'sync-test-setup-code' })
  dispose = t.dispose
  const reg = await handleApi(
    new Request('https://k.test/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupCode: 'sync-test-setup-code', name: 't' }) }),
    t.env,
  )
  const { token } = (await reg.json()) as { token: string }
  const call = (method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) =>
    handleApi(new Request(`https://k.test${path}`, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } }), t.env)
  const sync = (body: unknown) => call('POST', '/api/sync', JSON.stringify(body), { 'Content-Type': 'application/json' })
  return { call, sync }
}

const empty = { lessons: [], cards: [], logs: [], media: [], words: [], deletions: [] }

describe('/api/sync', () => {
  it('rejects malformed requests with 400', async () => {
    const { sync } = await setup()
    expect((await sync({ ...empty, since: -1 })).status).toBe(400)
    expect((await sync({ ...empty, since: 0, lessons: {} })).status).toBe(400)
    expect((await sync({ ...empty, since: 0, lessons: [{ uid: 1 }] })).status).toBe(400)
    expect((await sync({ ...empty, since: 0, deletions: [{ uid: 'x', table: 'logs', at: 1 }] })).status).toBe(400)
    const tooMany = Array.from({ length: MAX_PER_KIND + 1 }, (_, i) => ({ lemma: `w${i}`, firstSeen: 1 }))
    expect((await sync({ ...empty, since: 0, words: tooMany })).status).toBe(400)
  })

  it('keeps a deletion that arrived first against an older copy of the record', async () => {
    const { sync } = await setup()
    await sync({ ...empty, since: 0, deletions: [{ uid: 'L1', table: 'lessons', at: 100 }] })
    const lesson = { uid: 'L1', updatedAt: 50, title: 'old', sentences: [], progress: { roundsDone: 0, lastCompletedAt: null }, resume: null, hard: [], createdAt: 1 }
    const r = (await (await sync({ ...empty, since: 0, lessons: [lesson] })).json()) as { lessons: unknown[]; deletions: { uid: string }[] }
    expect(r.lessons).toEqual([])
    expect(r.deletions.map((d) => d.uid)).toEqual(['L1'])
  })

  it('returns only changes newer than `since`', async () => {
    const { sync } = await setup()
    const first = (await (await sync({ ...empty, since: 0, words: [{ lemma: '雨', firstSeen: 1 }] })).json()) as { seq: number; words: unknown[] }
    expect(first.words).toHaveLength(1)
    const again = (await (await sync({ ...empty, since: first.seq })).json()) as { seq: number; words: unknown[] }
    expect(again.words).toEqual([])
    expect(again.seq).toBe(first.seq)
  })
})

describe('/api/media', () => {
  it('only accepts bytes for a synced media record, within the size limit', async () => {
    const { call, sync } = await setup()
    const bytes = new Uint8Array([1, 2, 3])
    expect((await call('PUT', '/api/media/M1', bytes, { 'Content-Length': '3', 'Content-Type': 'audio/wav' })).status).toBe(409)
    await sync({ ...empty, since: 0, media: [{ uid: 'M1', updatedAt: 1, name: 'a.wav', type: 'audio/wav', size: 3 }] })
    expect((await call('PUT', '/api/media/M1', bytes, { 'Content-Length': String(200 * 1024 * 1024) })).status).toBe(413)
    expect((await call('PUT', '/api/media/M1', bytes, { 'Content-Length': '3', 'Content-Type': 'audio/wav' })).status).toBe(201)
    const got = await call('GET', '/api/media/M1')
    expect(got.headers.get('content-type')).toBe('audio/wav')
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([1, 2, 3])
    expect((await call('GET', '/api/media/nope')).status).toBe(404)
  })
})
