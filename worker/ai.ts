import Anthropic from '@anthropic-ai/sdk'
import { aiErrorCode, explainSentence, translateSentences } from '../src/lib/ai'
import type { Env } from './env'

/** Limits on what a device may send, to bound cost. */
export const MAX_SENTENCE_CHARS = 2000
export const MAX_CONTEXT_CHARS = 20_000
export const MAX_TRANSLATE_SENTENCES = 300

const LANGS = ['en', 'zh'] as const
type Lang = (typeof LANGS)[number]

export const aiEnabled = (env: Env) => Boolean(env.ANTHROPIC_API_KEY)

function client(env: Env, fetcher?: typeof fetch) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}), ...(fetcher ? { fetch: fetcher } : {}) })
}

const bad = (message: string) => Response.json({ error: message }, { status: 400 })
const disabled = () => Response.json({ error: 'AI is not configured on the server' }, { status: 503 })

/**
 * Streams an explanation as NDJSON lines: {"text": "..."} per chunk, then {"done": true} or
 * {"error": code}. (Errors after the first chunk can't change the HTTP status any more.)
 */
export async function explain(env: Env, body: Record<string, unknown> | null, fetcher?: typeof fetch): Promise<Response> {
  if (!aiEnabled(env)) return disabled()
  const sentence = body?.sentence
  const lang = body?.lang
  const context = body?.context ?? []
  if (typeof sentence !== 'string' || !sentence || sentence.length > MAX_SENTENCE_CHARS) return bad('sentence is required (max 2000 chars)')
  if (!LANGS.includes(lang as Lang)) return bad('lang must be en or zh')
  if (!Array.isArray(context) || !context.every((c) => typeof c === 'string') || context.join('').length > MAX_CONTEXT_CHARS) return bad('context must be strings (max 20000 chars)')

  const encoder = new TextEncoder()
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const line = (obj: unknown) => writer.write(encoder.encode(JSON.stringify(obj) + '\n'))
  const run = (async () => {
    try {
      await explainSentence(client(env, fetcher), { sentence, lang: lang as Lang, context: context as string[], onText: (text) => void line({ text }) })
      await line({ done: true })
    } catch (e) {
      await line({ error: aiErrorCode(e) })
    } finally {
      await writer.close()
    }
  })()
  void run
  return new Response(stream.readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function translate(env: Env, body: Record<string, unknown> | null, fetcher?: typeof fetch): Promise<Response> {
  if (!aiEnabled(env)) return disabled()
  const sentences = body?.sentences
  const lang = body?.lang
  if (!Array.isArray(sentences) || !sentences.length || sentences.length > MAX_TRANSLATE_SENTENCES || !sentences.every((s) => typeof s === 'string' && s.length <= MAX_SENTENCE_CHARS)) {
    return bad('sentences must be 1–300 strings')
  }
  if (!LANGS.includes(lang as Lang)) return bad('lang must be en or zh')
  try {
    return Response.json({ translations: await translateSentences(client(env, fetcher), sentences as string[], lang as Lang) })
  } catch (e) {
    return Response.json({ error: aiErrorCode(e) }, { status: 502 })
  }
}
