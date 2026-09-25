import { describe, expect, it } from 'vitest'
import { explain, translate } from './ai'
import type { Env } from './env'

const env = { ANTHROPIC_API_KEY: 'server-key' } as Env

function sse(chunks: string[], stop = 'end_turn') {
  const msg = { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } }
  const events = [
    { type: 'message_start', message: msg },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...chunks.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

const lines = async (res: Response) => (await res.text()).trim().split('\n').map((l) => JSON.parse(l))

describe('/api/ai/explain', () => {
  it('streams chunks as NDJSON using the server key', async () => {
    let key: string | null = null
    const fetcher = (async (_url: string, init: RequestInit) => {
      key = new Headers(init.headers).get('x-api-key')
      return sse(['「は」は', '主题。'])
    }) as typeof fetch
    const res = await explain(env, { sentence: '私は学生です。', lang: 'zh', context: [] }, fetcher)
    expect(res.headers.get('content-type')).toContain('ndjson')
    expect(await lines(res)).toEqual([{ text: '「は」は' }, { text: '主题。' }, { done: true }])
    expect(key).toBe('server-key')
  })

  it('reports a refusal as an error line', async () => {
    const res = await explain(env, { sentence: 'x', lang: 'en' }, (async () => sse([], 'refusal')) as typeof fetch)
    expect((await lines(res)).at(-1)).toEqual({ error: 'refusal' })
  })

  it('validates input and stays off without a key', async () => {
    expect((await explain(env, { sentence: '', lang: 'en' })).status).toBe(400)
    expect((await explain(env, { sentence: 'x'.repeat(2001), lang: 'en' })).status).toBe(400)
    expect((await explain(env, { sentence: 'x', lang: 'fr' })).status).toBe(400)
    expect((await explain(env, { sentence: 'x', lang: 'en', context: ['y'.repeat(20_001)] })).status).toBe(400)
    expect((await explain({} as Env, { sentence: 'x', lang: 'en' })).status).toBe(503)
  })
})

describe('/api/ai/translate', () => {
  const message = (text: string) =>
    Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })

  it('returns one translation per sentence', async () => {
    const res = await translate(env, { sentences: ['一。', '二。'], lang: 'en' }, (async () => message(JSON.stringify({ translations: ['One.', 'Two.'] }))) as typeof fetch)
    expect(await res.json()).toEqual({ translations: ['One.', 'Two.'] })
  })

  it('maps failures to error codes', async () => {
    const res = await translate(env, { sentences: ['一。', '二。'], lang: 'en' }, (async () => message(JSON.stringify({ translations: ['only one'] }))) as typeof fetch)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'count' })
    expect((await translate(env, { sentences: [], lang: 'en' })).status).toBe(400)
  })
})
