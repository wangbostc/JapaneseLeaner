import { useEffect, useSyncExternalStore } from 'react'
import { setNeuralSynth, type NeuralSynth } from '../lib/speech'
import { DEFAULT_NEURAL_VOICE, DEFAULT_VOICEVOX_VOICE, isVoicevoxId, type NaturalVoiceId, type NeuralVoice, type VoicevoxVoice, type VoicevoxVoiceId } from '../lib/voices'
import type { Api } from '../lib/sync'
import { storedDeviceApi, useSyncStatus } from './sync'
import { engineUrl, probeEngine, synthesize } from './voicevox'

/**
 * Natural voices, from two places:
 * - Azure neural voices through the server, when it has a Speech key;
 * - VOICEVOX (open source), from the engine on this computer when it's turned on in Settings.
 *   Clips made here are uploaded, so the learner's other devices play them from the server.
 *
 * Each sentence's audio is kept in Cache Storage, so it plays again instantly and offline. The
 * server's voice lists are remembered, so a device opened offline still plays what it has cached
 * (and uses its own voice for the rest).
 */

const CACHE = 'tts-v1'
const VOICES_KEY = 'kikitori.neuralVoices'
/** 20–100 KB a sentence (MP3 from Azure, WAV from VOICEVOX): this stays within typical storage quotas. */
export const MAX_CACHED = 2000
/** A server that doesn't answer shouldn't stall a lesson; the device voice takes over. */
const FETCH_TIMEOUT_MS = 10_000

interface Known {
  /** The server's Azure voices, or null when it has none. */
  azure: readonly NeuralVoice[] | null
  /** VOICEVOX voices with clips on the server, most recently used first. */
  prepared: readonly VoicevoxVoice[]
}

/** What Settings and the lesson page show. */
export interface NaturalVoices {
  azure: readonly NeuralVoice[] | null
  /** This computer's engine voices when it's running, else the server's prepared ones (or null). */
  voicevox: readonly VoicevoxVoice[] | null
  /** True when the VOICEVOX engine on this computer answered. */
  engineUp: boolean
}

const remembered = (): Known => {
  try {
    const v = JSON.parse(localStorage.getItem(VOICES_KEY) ?? 'null')
    // Before VOICEVOX, only the Azure list was kept.
    if (Array.isArray(v)) return { azure: v.length ? v : null, prepared: [] }
    if (v && typeof v === 'object') return { azure: Array.isArray(v.azure) && v.azure.length ? v.azure : null, prepared: Array.isArray(v.prepared) ? v.prepared : [] }
  } catch {
    /* fall through */
  }
  return { azure: null, prepared: [] }
}
const remember = (k: Known | null) => {
  try {
    if (k && (k.azure?.length || k.prepared.length)) localStorage.setItem(VOICES_KEY, JSON.stringify(k))
    else localStorage.removeItem(VOICES_KEY)
  } catch {
    /* storage blocked: natural voices last for this session */
  }
}

let known: Known = { azure: null, prepared: [] }
let engine: readonly VoicevoxVoice[] | null = null
let snapshot: NaturalVoices = { azure: null, voicevox: null, engineUp: false }
let checking: Promise<void> | null = null
let askedThisConnection = false
const listeners = new Set<() => void>()

/** Recomputes what can speak. Server voices need a device token (they're off when disconnected or revoked); the engine doesn't. */
function apply() {
  const api = storedDeviceApi()
  const azure = api && known.azure?.length ? known.azure : null
  const prepared = api ? known.prepared : []
  const voicevox = engine?.length ? engine : prepared.length ? prepared : null
  snapshot = { azure, voicevox, engineUp: !!engine?.length }
  const fallback: NaturalVoiceId | undefined = azure
    ? DEFAULT_NEURAL_VOICE
    : engine?.length
      ? (engine.find((v) => v.id === DEFAULT_VOICEVOX_VOICE) ?? engine[0]).id
      : prepared[0]?.id
  setNeuralSynth(fallback ? neuralSynth(api) : null, fallback)
  listeners.forEach((l) => l())
}

export function refreshNeuralVoices(): Promise<void> {
  const api = storedDeviceApi()
  if (!api) {
    known = { azure: null, prepared: [] }
    remember(null)
    apply()
    return Promise.resolve()
  }
  checking ??= api('/api/tts')
    .then(async (res) => {
      if (res.status === 401) known = { azure: null, prepared: [] }
      else if (res.ok) {
        const body = (await res.json()) as { enabled: boolean; voices: NeuralVoice[]; prepared?: VoicevoxVoice[] }
        known = { azure: body.enabled && body.voices.length ? body.voices : null, prepared: body.prepared ?? [] }
        remember(known)
      }
      apply()
    })
    .catch(() => undefined) // unreachable: keep what we had
    .finally(() => (checking = null))
  return checking
}

/** Asks this computer's VOICEVOX engine (if turned on) which voices it has. */
export async function refreshEngine(): Promise<boolean> {
  const url = engineUrl()
  engine = url ? await probeEngine(url) : null
  apply()
  return !!engine
}

/** The natural voices this device can use. Mounted in the app shell so every page speaks with them. */
export function useNaturalVoices(): NaturalVoices {
  const sync = useSyncStatus()
  const value = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot,
    () => snapshot,
  )
  useEffect(() => {
    // Connected: ask the server (voices may have changed). Disconnected or revoked: server voices off.
    // Unreachable ('unavailable'): keep the remembered lists, so cached audio still plays.
    const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
    if (connected && !askedThisConnection) {
      askedThisConnection = true
      void refreshNeuralVoices()
    } else if (sync.kind === 'disconnected') {
      askedThisConnection = false
      known = { azure: null, prepared: [] }
      remember(null)
      apply()
    }
  }, [sync.kind])
  return value
}

async function cacheUrl(voice: NaturalVoiceId, text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${voice}\n${text}`))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  // Only a cache key, never fetched: a fixed made-up origin keeps it the same wherever the app runs.
  return `https://tts.kikitori.invalid/${voice.replace(':', '-')}/${hex}`
}

const openCache = () => (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE).catch(() => null))

/** Drops the oldest entries (keys come back in insertion order) once the cache passes its cap. */
async function trim(store: Cache, max: number) {
  const keys = await store.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => store.delete(k)))
}

interface Engine {
  url: string
  voices: readonly VoicevoxVoice[]
}
const currentEngine = (): Engine | null => {
  const url = engineUrl()
  return url && engine?.length ? { url, voices: engine } : null
}

/** Puts a VOICEVOX clip on the server, naming the voice so other devices can choose it. */
async function upload(api: Api, voices: readonly VoicevoxVoice[], voice: VoicevoxVoiceId, text: string, blob: Blob) {
  const meta = voices.find((v) => v.id === voice)
  const q = new URLSearchParams({ voice, text, ...(meta ? { name: meta.name, speaker: meta.speaker } : {}) })
  const res = await api(`/api/tts/clip?${q}`, { method: 'PUT', headers: { 'Content-Type': blob.type || 'audio/wav' }, body: blob })
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
}

async function fromServer(api: Api | null, text: string, voice: NaturalVoiceId): Promise<Blob> {
  if (!api) throw new Error('notConnected')
  const res = await api('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
  return res.blob()
}

/** Same text and voice at once (a prefetch, then the play) share one request. */
const inflight = new Map<string, Promise<Blob>>()

export function neuralSynth(
  api: Api | null,
  cache: () => Promise<Cache | null> = openCache,
  max = MAX_CACHED,
  getEngine: () => Engine | null = currentEngine,
): NeuralSynth {
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
        let blob: Blob
        const eng = isVoicevoxId(voice) ? getEngine() : null
        if (eng) {
          try {
            blob = await synthesize(eng.url, voice as VoicevoxVoiceId, text)
            // Made here: share it with the learner's other devices (best effort; "Prepare" retries).
            if (api) void upload(api, eng.voices, voice as VoicevoxVoiceId, text, blob).catch(() => undefined)
          } catch {
            blob = await fromServer(api, text, voice) // engine stopped: maybe it was uploaded earlier
          }
        } else blob = await fromServer(api, text, voice)
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

/**
 * Makes every sentence in a VOICEVOX voice on this computer and uploads it, so the learner's other
 * devices can play the whole lesson. Re-uploads clips cached here earlier (maybe while offline).
 */
export async function prepareClips(texts: string[], voice: VoicevoxVoiceId, onProgress: (done: number) => void, cache = openCache): Promise<void> {
  const api = storedDeviceApi()
  const eng = currentEngine()
  if (!api || !eng) throw new Error(api ? 'engineOff' : 'notConnected')
  const store = await cache()
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
  for (const [i, text] of unique.entries()) {
    const url = store ? await cacheUrl(voice, text) : null
    const hit = url ? await store!.match(url) : undefined
    const blob = hit ? await hit.blob() : await synthesize(eng.url, voice, text)
    await upload(api, eng.voices, voice, text, blob)
    if (url && !hit) await store!.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/wav' } })).catch(() => undefined)
    onProgress(i + 1)
  }
  if (store) await trim(store, MAX_CACHED).catch(() => undefined)
  // The server now lists this voice for the other devices.
  await refreshNeuralVoices()
}

// Last, once everything above is defined: a device opened offline starts with what it knew last time,
// and a computer with VOICEVOX turned on looks for its engine.
if (typeof window !== 'undefined') {
  known = remembered()
  apply()
  if (engineUrl()) void refreshEngine()
}
