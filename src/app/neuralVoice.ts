import { useEffect, useSyncExternalStore } from 'react'
import { setNeuralSynth, type NeuralSynth } from '../lib/speech'
import type { NeuralVoice, NeuralVoiceId } from '../lib/voices'
import type { Api } from '../lib/sync'
import { storedDeviceApi, useSyncStatus } from './sync'

/**
 * Natural voices through the server (Azure neural TTS): on for a connected device whose server
 * has a Speech key. Each sentence's audio is kept in Cache Storage, so it plays again instantly,
 * and offline too: the voice list is remembered, so a device opened offline still plays what
 * it has cached (and uses its own voice for the rest).
 */

const CACHE = 'tts-v1'
const VOICES_KEY = 'kikitori.neuralVoices'
/** About 20 KB a sentence: a few thousand sentences stay well under typical storage quotas. */
export const MAX_CACHED = 3000
/** A server that doesn't answer shouldn't stall a lesson; the device voice takes over. */
const FETCH_TIMEOUT_MS = 10_000

const remembered = (): NeuralVoice[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(VOICES_KEY) ?? 'null')
    return Array.isArray(v) && v.length ? v : null
  } catch {
    return null
  }
}
const remember = (v: readonly NeuralVoice[] | null) => {
  try {
    if (v?.length) localStorage.setItem(VOICES_KEY, JSON.stringify(v))
    else localStorage.removeItem(VOICES_KEY)
  } catch {
    /* storage blocked: natural voices last for this session */
  }
}

let voices: readonly NeuralVoice[] | null = null
let checking: Promise<void> | null = null
let askedThisConnection = false
const listeners = new Set<() => void>()

/** Natural voices need a device token; without one (disconnected, revoked) they're off, whatever the list says. */
function set(v: readonly NeuralVoice[] | null) {
  const api = storedDeviceApi()
  voices = api && v?.length ? v : null
  setNeuralSynth(api && voices ? neuralSynth(api) : null)
  listeners.forEach((l) => l())
}

export function refreshNeuralVoices(): Promise<void> {
  const api = storedDeviceApi()
  if (!api) {
    remember(null)
    set(null)
    return Promise.resolve()
  }
  checking ??= api('/api/tts')
    .then(async (res) => {
      if (!res.ok) return set(res.status === 401 ? null : voices) // 401: revoked; otherwise keep what we had
      const body = (await res.json()) as { enabled: boolean; voices: NeuralVoice[] }
      const list = body.enabled ? body.voices : null
      remember(list)
      set(list)
    })
    .catch(() => undefined) // unreachable: keep what we had
    .finally(() => (checking = null))
  return checking
}

/** The natural voices this device can use, or null. Mounted in the app shell so every page speaks with them. */
export function useNeuralVoices(): readonly NeuralVoice[] | null {
  const sync = useSyncStatus()
  const value = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => voices,
    () => voices,
  )
  useEffect(() => {
    // Connected: ask the server (voices may have been switched on or off). Disconnected or revoked: off.
    // Unreachable ('unavailable'): keep the remembered list, so cached audio still plays.
    const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
    if (connected && !askedThisConnection) {
      askedThisConnection = true
      void refreshNeuralVoices()
    } else if (sync.kind === 'disconnected') {
      askedThisConnection = false
      remember(null)
      set(null)
    }
  }, [sync.kind])
  return value
}

async function cacheUrl(voice: NeuralVoiceId, text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${voice}\n${text}`))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  // Only a cache key, never fetched: a fixed made-up origin keeps it the same wherever the app runs.
  return `https://tts.kikitori.invalid/${voice}/${hex}.mp3`
}

const openCache = () => (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE).catch(() => null))

/** Drops the oldest entries (keys come back in insertion order) once the cache passes its cap. */
async function trim(store: Cache, max: number) {
  const keys = await store.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => store.delete(k)))
}

/** Same text and voice at once (a prefetch, then the play) share one request. */
const inflight = new Map<string, Promise<Blob>>()

export function neuralSynth(api: Api, cache: () => Promise<Cache | null> = openCache, max = MAX_CACHED): NeuralSynth {
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
        const res = await api('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
        const blob = await res.blob()
        if (url) {
          await store!.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } })).catch(() => undefined)
          await trim(store!, max).catch(() => undefined)
        }
        return blob
      })().finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    if (!signal) return pending
    // The caller may give up waiting; the shared request carries on for anyone else.
    return new Promise<Blob>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
      const stop = () => reject(new DOMException('aborted', 'AbortError'))
      signal.addEventListener('abort', stop, { once: true })
      pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
    })
  }
}

// Last, once everything above is defined: a device opened offline starts with what it knew last time.
if (typeof window !== 'undefined') set(remembered())
