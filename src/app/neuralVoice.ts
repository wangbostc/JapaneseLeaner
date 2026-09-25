import { useEffect, useSyncExternalStore } from 'react'
import { setNeuralSynth, type NeuralSynth } from '../lib/speech'
import type { NeuralVoice, NeuralVoiceId } from '../lib/voices'
import type { Api } from '../lib/sync'
import { deviceApi, useSyncStatus } from './sync'

/**
 * Natural voices through the server (Azure neural TTS): on when this device is connected and the
 * server has a Speech key. Each sentence's audio is kept in Cache Storage, so it plays again
 * instantly and offline, and the server's free quota is spent once per sentence and voice.
 */

const CACHE = 'tts-v1'

let voices: readonly NeuralVoice[] | null = null
let checking: Promise<void> | null = null
const listeners = new Set<() => void>()
function set(v: readonly NeuralVoice[] | null) {
  voices = v
  const api = v?.length ? deviceApi() : null
  setNeuralSynth(api ? neuralSynth(api) : null)
  listeners.forEach((l) => l())
}

export function refreshNeuralVoices(): Promise<void> {
  const api = deviceApi()
  if (!api) {
    set(null)
    return Promise.resolve()
  }
  checking ??= api('/api/tts')
    .then(async (res) => {
      const body = res.ok ? ((await res.json()) as { enabled: boolean; voices: NeuralVoice[] }) : null
      set(body?.enabled ? body.voices : null)
    })
    .catch(() => set(null))
    .finally(() => (checking = null))
  return checking
}

/** The server's natural voices, or null when there are none (not connected, or no key). Keeps speech in step. */
export function useNeuralVoices(): readonly NeuralVoice[] | null {
  const sync = useSyncStatus()
  const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
  const value = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => voices,
    () => voices,
  )
  useEffect(() => {
    if (connected && voices === null && !checking) void refreshNeuralVoices()
    if (!connected && voices !== null) set(null)
  }, [connected])
  return connected ? value : null
}

async function cacheUrl(voice: NeuralVoiceId, text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${voice}\n${text}`))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  // Only a cache key, never fetched: a fixed made-up origin keeps it the same wherever the app runs.
  return `https://tts.kikitori.invalid/${voice}/${hex}.mp3`
}

const openCache = () => (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE).catch(() => null))

/** Same text and voice at once (a prefetch, then the play) share one request. */
const inflight = new Map<string, Promise<Blob>>()

export function neuralSynth(api: Api, cache: () => Promise<Cache | null> = openCache): NeuralSynth {
  return async (text, voice, signal) => {
    text = text.trim()
    const key = `${voice}\n${text}`
    let pending = inflight.get(key)
    if (!pending) {
      pending = (async () => {
        const store = await cache()
        const url = store ? await cacheUrl(voice, text) : null
        const hit = url ? await store!.match(url) : undefined
        if (hit) return hit.blob()
        // Not tied to one caller's signal: a prefetch and a play may share it.
        const res = await api('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) })
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
        const blob = await res.blob()
        if (url) await store!.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } })).catch(() => undefined)
        return blob
      })().finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    if (!signal) return pending
    // The caller may give up waiting; the shared request carries on for anyone else.
    return new Promise<Blob>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      pending.then(resolve, reject)
    })
  }
}
