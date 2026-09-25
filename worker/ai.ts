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

// Errors carry codes the app translates (see AiErrorCode), not sentences.
const bad = (code: 'tooLong' | 'invalid') => Response.json({ error: code }, { status: 400 })
const disabled = () => Response.json({ error: 'serverOff' }, { status: 503 })

/**
 * Streams an explanation as NDJSON lines: {"text": "..."} per chunk, then {"done": true} or
 * {"error": code}. (Errors after the first chunk can't change the HTTP status any more.)
 */
export async function explain(env: Env, body: Record<string, unknown> | null, fetcher?: typeof fetch, signal?: AbortSignal): Promise<Response> {
  if (!aiEnabled(env)) return disabled()
  const sentence = body?.sentence
  const lang = body?.lang
  const context = body?.context ?? []
  if (typeof sentence !== 'string' || !sentence) return bad('invalid')
  if (!LANGS.includes(lang as Lang)) return bad('invalid')
  if (!Array.isArray(context) || !context.every((c) => typeof c === 'string')) return bad('invalid')
  if (sentence.length > MAX_SENTENCE_CHARS || context.join('').length > MAX_CONTEXT_CHARS) return bad('tooLong')

  const encoder = new TextEncoder()
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  // If the client goes away, writes reject; there's nobody left to tell, so swallow that.
  const line = (obj: unknown) => writer.write(encoder.encode(JSON.stringify(obj) + '\n')).catch(() => undefined)
  const run = (async () => {
    try {
      // The request's signal: a client that disconnects stops the upstream stream (and its cost).
      await explainSentence(client(env, fetcher), { sentence, lang: lang as Lang, context: context as string[], signal, onText: (text) => void line({ text }) })
      await line({ done: true })
    } catch (e) {
      await line({ error: aiErrorCode(e) })
    } finally {
      await writer.close().catch(() => undefined)
    }
  })()
  void run
  return new Response(stream.readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function translate(env: Env, body: Record<string, unknown> | null, fetcher?: typeof fetch): Promise<Response> {
  if (!aiEnabled(env)) return disabled()
  const sentences = body?.sentences
  const lang = body?.lang
  if (!Array.isArray(sentences) || !sentences.length || !sentences.every((s) => typeof s === 'string')) return bad('invalid')
  if (!LANGS.includes(lang as Lang)) return bad('invalid')
  if (sentences.length > MAX_TRANSLATE_SENTENCES || sentences.some((s) => (s as string).length > MAX_SENTENCE_CHARS)) return bad('tooLong')
  try {
    return Response.json({ translations: await translateSentences(client(env, fetcher), sentences as string[], lang as Lang) })
  } catch (e) {
    return Response.json({ error: aiErrorCode(e) }, { status: 502 })
  }
}
