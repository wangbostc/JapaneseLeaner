import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { AI_MODEL, describeAiError, explainSentence, translateSentences } from './ai'

type Captured = { url: string; body: Record<string, unknown>; headers: Headers }

/** A real SDK client whose HTTP layer is a stub, so requests and parsing are exercised end to end. */
function clientReturning(respond: (req: Captured) => Response) {
  const calls: Captured[] = []
  const client = new Anthropic({
    apiKey: 'test-key',
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    fetch: async (url, init) => {
      const req = { url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) }
      calls.push(req)
      return respond(req)
    },
  })
  return { client, calls }
}

const message = (text: string, stop_reason = 'end_turn') =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: AI_MODEL,
    content: [{ type: 'text', text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  })

function sse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

describe('translateSentences', () => {
  it('asks for one translation per sentence and returns them in order', async () => {
    const { client, calls } = clientReturning(() => message(JSON.stringify({ translations: ['Good morning.', 'Nice weather.'] })))
    const out = await translateSentences(client, ['おはよう。', 'いい天気。'], 'en')
    expect(out).toEqual(['Good morning.', 'Nice weather.'])

    const { body, headers } = calls[0]
    expect(body.model).toBe('claude-opus-5')
    expect(body.fallbacks).toBe('default')
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    expect((body.messages as { content: string }[])[0].content).toBe('1. おはよう。\n2. いい天気。')
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema')
  })

  it('rejects a reply with the wrong number of translations', async () => {
    const { client } = clientReturning(() => message(JSON.stringify({ translations: ['only one'] })))
    await expect(translateSentences(client, ['一。', '二。'], 'zh')).rejects.toThrow('expected 2 translations, got 1')
  })

  it('reports a refusal instead of parsing nothing', async () => {
    const { client } = clientReturning(() => message('', 'refusal'))
    const err = await translateSentences(client, ['一。'], 'en').catch((e) => e)
    expect(describeAiError(err)).toBe('The assistant declined to translate this lesson.')
  })

  it('turns a rejected key into a readable message', async () => {
    const { client } = clientReturning(() =>
      Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 }),
    )
    const err = await translateSentences(client, ['一。'], 'en').catch((e) => e)
    expect(describeAiError(err)).toBe('The API key was rejected. Check it in Settings.')
  })
})

describe('explainSentence', () => {
  it('streams text chunks in the learner’s language', async () => {
    const { client, calls } = clientReturning(() =>
      sse([
        { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: AI_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '「は」は' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '主题标记。' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
        { type: 'message_stop' },
      ]),
    )
    const chunks: string[] = []
    await explainSentence(client, { sentence: '私は学生です。', lang: 'zh', onText: (c) => chunks.push(c) })
    expect(chunks.join('')).toBe('「は」は主题标记。')
    expect(calls[0].body.stream).toBe(true)
    expect(String(calls[0].body.system)).toContain('Simplified Chinese')
  })
})
