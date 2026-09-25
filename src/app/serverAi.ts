import { useEffect, useSyncExternalStore } from 'react'
import { AI_ERROR_CODES, AiError, type AiErrorCode } from '../lib/ai'
import { deviceApi, useSyncStatus } from './sync'

/** AI through the server's own key: available when this device is connected and the server has a key. */

// Availability is fetched once per connection and shared, so panels don't each ask (and pop in late).
let available: boolean | null = null
let checking: Promise<void> | null = null
const listeners = new Set<() => void>()
const set = (v: boolean | null) => {
  available = v
  listeners.forEach((l) => l())
}

export function refreshServerAi(): Promise<void> {
  const api = deviceApi()
  if (!api) {
    set(false)
    return Promise.resolve()
  }
  checking ??= api('/api/ai')
    .then(async (res) => set(res.ok && ((await res.json()) as { enabled: boolean }).enabled))
    .catch(() => set(false))
    .finally(() => (checking = null))
  return checking
}

export function useServerAi(): boolean {
  const sync = useSyncStatus()
  const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
  const value = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => available,
    () => available,
  )
  useEffect(() => {
    if (connected && available === null) void refreshServerAi()
    if (!connected && available !== null) set(null)
  }, [connected])
  return connected && value === true
}

/** Server replies carry an error code; anything else is mapped from the HTTP status. */
export function codeFor(status: number, error: unknown): AiErrorCode {
  // In server mode a rejected key is the server's, and a 401 means this device was revoked.
  if (error === 'auth') return 'serverKey'
  if (typeof error === 'string' && (AI_ERROR_CODES as readonly string[]).includes(error)) return error as AiErrorCode
  if (status === 401) return 'reconnect'
  if (status === 503) return 'serverOff'
  if (status === 400) return 'invalid'
  return 'api'
}

const MAX_CONTEXT_CHARS = 18_000 // under the server's 20k cap

/** The sentences around `sentence`, nearest first, within the server's size limit. */
export function trimContext(context: string[], sentence: string, max = MAX_CONTEXT_CHARS): string[] {
  if (context.join('').length <= max) return context
  const at = Math.max(0, context.indexOf(sentence))
  let lo = at
  let hi = at
  let size = context[at]?.length ?? 0
  // Grow outward, alternating sides so the window stays centred; stop at the first that doesn't fit.
  while (lo > 0 || hi < context.length - 1) {
    const canNext = hi < context.length - 1
    const canPrev = lo > 0
    const takeNext = canNext && (!canPrev || hi - at <= at - lo)
    const len = takeNext ? context[hi + 1].length : context[lo - 1].length
    if (size + len > max) break
    size += len
    if (takeNext) hi++
    else lo--
  }
  return context.slice(lo, hi + 1)
}

/** Streams an explanation from the server (NDJSON: {text} chunks, then {done} or {error}). */
export async function explainViaServer(args: { sentence: string; lang: 'en' | 'zh'; context: string[]; signal?: AbortSignal; onText: (chunk: string) => void }) {
  const api = deviceApi()
  if (!api) throw new AiError('reconnect')
  const res = await api('/api/ai/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentence: args.sentence, lang: args.lang, context: trimContext(args.context, args.sentence) }),
    signal: args.signal,
  }).catch(() => {
    throw new AiError('offline')
  })
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown }
    throw new AiError(codeFor(res.status, body.error))
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let finished = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const msg = JSON.parse(line) as { text?: string; done?: boolean; error?: unknown }
      if (msg.error) throw new AiError(codeFor(200, msg.error))
      if (msg.text) args.onText(msg.text)
      if (msg.done) finished = true
    }
  }
  // A stream that stops without its closing line was cut off.
  if (!finished) throw new AiError('offline')
}

const TRANSLATE_BATCH = 200 // under the server's 300

/** Translates through the server, in batches so long lessons fit its per-request limit. */
export async function translateViaServer(sentences: string[], lang: 'en' | 'zh'): Promise<string[]> {
  const api = deviceApi()
  if (!api) throw new AiError('reconnect')
  const out: string[] = []
  for (let i = 0; i < sentences.length; i += TRANSLATE_BATCH) {
    const batch = sentences.slice(i, i + TRANSLATE_BATCH)
    const res = await api('/api/ai/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentences: batch, lang }) }).catch(() => {
      throw new AiError('offline')
    })
    const body = (await res.json().catch(() => ({}))) as { translations?: string[]; error?: unknown }
    if (!res.ok || !body.translations) throw new AiError(codeFor(res.status, body.error))
    out.push(...body.translations)
  }
  return out
}
