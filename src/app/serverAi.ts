import { useEffect, useState } from 'react'
import { AiError, type AiErrorCode } from '../lib/ai'
import { deviceApi, useSyncStatus } from './sync'

/** AI through the server's own key: available when this device is connected and the server has a key. */
export async function serverAiAvailable(): Promise<boolean> {
  const api = deviceApi()
  if (!api) return false
  const res = await api('/api/ai').catch(() => null)
  return Boolean(res?.ok && ((await res.json()) as { enabled: boolean }).enabled)
}

export function useServerAi(): boolean {
  const sync = useSyncStatus()
  const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!connected) return
    let live = true
    serverAiAvailable().then((a) => live && setAvailable(a))
    return () => {
      live = false
    }
  }, [connected])
  // Derived rather than reset in the effect: disconnected means unavailable.
  return connected && available
}

const fail = (code: AiErrorCode) => new AiError(code)

/** Streams an explanation from the server (NDJSON: {text} chunks, then {done} or {error}). */
export async function explainViaServer(args: { sentence: string; lang: 'en' | 'zh'; context: string[]; signal?: AbortSignal; onText: (chunk: string) => void }) {
  const api = deviceApi()
  if (!api) throw fail('auth')
  const res = await api('/api/ai/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentence: args.sentence, lang: args.lang, context: args.context }),
    signal: args.signal,
  }).catch(() => {
    throw fail('offline')
  })
  if (res.status === 503) throw fail('api')
  if (!res.ok || !res.body) throw fail(res.status === 401 ? 'auth' : 'api')
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const msg = JSON.parse(line) as { text?: string; done?: boolean; error?: AiErrorCode }
      if (msg.error) throw fail(msg.error)
      if (msg.text) args.onText(msg.text)
    }
  }
}

export async function translateViaServer(sentences: string[], lang: 'en' | 'zh'): Promise<string[]> {
  const api = deviceApi()
  if (!api) throw fail('auth')
  const res = await api('/api/ai/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentences, lang }) }).catch(() => {
    throw fail('offline')
  })
  const body = (await res.json().catch(() => ({}))) as { translations?: string[]; error?: AiErrorCode }
  if (!res.ok || !body.translations) throw fail(body.error ?? 'api')
  return body.translations
}
