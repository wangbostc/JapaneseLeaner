import { styleOf, type EngineKind, type EngineVoice, type EngineVoiceId } from './voices'

/**
 * The HTTP API of the open-source speech engines on the learner's computer: VOICEVOX and
 * AivisSpeech, which speaks the same API. Shared by the web app (which only contacts them once
 * they're turned on) and the macOS app.
 */

export const DEFAULT_ENGINE_URLS: Record<EngineKind, string> = { voicevox: 'http://127.0.0.1:50021', aivis: 'http://127.0.0.1:10101' }
const PROBE_TIMEOUT_MS = 2000
const SYNTH_TIMEOUT_MS = 30_000
/** Both engines can make 24 kHz; AivisSpeech defaults to 44.1 kHz, twice the size for speech. */
const SAMPLE_RATE = 24_000

/** A fetch to use instead of the global one (which is read at call time, so tests can stub it). */
type Fetch = typeof fetch

interface Speaker {
  name: string
  styles: { name: string; id: number; type?: string }[]
}

/** One engine's talking voices, one per character style, or null if it doesn't answer. */
export async function probeEngine(kind: EngineKind, url: string, timeoutMs = PROBE_TIMEOUT_MS, fetchImpl?: Fetch): Promise<EngineVoice[] | null> {
  try {
    const res = await (fetchImpl ?? fetch)(`${url}/speakers`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const speakers = (await res.json()) as Speaker[]
    return speakers.flatMap((sp) =>
      sp.styles
        .filter((st) => (st.type ?? 'talk') === 'talk')
        .map((st) => ({ id: `${kind}:${st.id}` as EngineVoiceId, name: `${sp.name}（${st.name}）`, speaker: sp.name })),
    )
  } catch {
    return null
  }
}

/** Every engine's voices (AivisSpeech first), and which engines answered with voices. */
export async function probeEngines(urls: Record<EngineKind, string>, fetchImpl?: Fetch): Promise<{ voices: EngineVoice[]; up: EngineKind[] }> {
  const order: EngineKind[] = ['aivis', 'voicevox']
  const found = await Promise.all(order.map((k) => probeEngine(k, urls[k], undefined, fetchImpl)))
  return { voices: found.flatMap((v) => v ?? []), up: order.filter((_, i) => !!found[i]?.length) }
}

/**
 * One sentence as 24 kHz WAV: the engine's two-step query, then synthesis. `signal` cancels it
 * (as does a 30 s timeout).
 */
export async function synthesize(url: string, voice: EngineVoiceId, text: string, signal?: AbortSignal, fetchImpl?: Fetch): Promise<Blob> {
  const get = fetchImpl ?? fetch
  const speaker = styleOf(voice)
  const timeout = AbortSignal.timeout(SYNTH_TIMEOUT_MS)
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout
  const q = await get(`${url}/audio_query?${new URLSearchParams({ speaker, text })}`, { method: 'POST', signal: both })
  if (!q.ok) throw new Error(`audio_query: HTTP ${q.status}`)
  const query = { ...((await q.json()) as Record<string, unknown>), outputSamplingRate: SAMPLE_RATE }
  const res = await get(`${url}/synthesis?${new URLSearchParams({ speaker })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
    signal: both,
  })
  if (!res.ok) throw new Error(`synthesis: HTTP ${res.status}`)
  const blob = await res.blob()
  return blob.type ? blob : new Blob([blob], { type: 'audio/wav' })
}
