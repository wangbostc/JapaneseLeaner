import { ENGINES, styleOf, type EngineKind, type EngineVoice, type EngineVoiceId } from '../lib/voices'

/**
 * Open-source speech engines on this computer: VOICEVOX and AivisSpeech, which speaks the same
 * HTTP API. They are only contacted once the learner turns them on in Settings: a page that probes
 * localhost can trigger the browser's local-network permission prompt, which a phone without an
 * engine should never show.
 */

// The switch predates AivisSpeech: `kikitori.voicevox` holds VOICEVOX's address and means "on".
const ON_KEY = 'kikitori.voicevox'
const AIVIS_KEY = 'kikitori.aivis'
export const DEFAULT_URLS: Record<EngineKind, string> = { voicevox: 'http://127.0.0.1:50021', aivis: 'http://127.0.0.1:10101' }
const PROBE_TIMEOUT_MS = 2000
const SYNTH_TIMEOUT_MS = 30_000
/** Both engines can make 24 kHz; AivisSpeech defaults to 44.1 kHz, twice the size for speech. */
const SAMPLE_RATE = 24_000

const get = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Each engine's address while engines are turned on for this device, else null. */
export function engineUrls(): Record<EngineKind, string> | null {
  const voicevox = get(ON_KEY)
  return voicevox ? { voicevox, aivis: get(AIVIS_KEY) ?? DEFAULT_URLS.aivis } : null
}

export function setEnginesOn(on: boolean) {
  try {
    if (on) {
      localStorage.setItem(ON_KEY, DEFAULT_URLS.voicevox)
      localStorage.setItem(AIVIS_KEY, DEFAULT_URLS.aivis)
    } else {
      localStorage.removeItem(ON_KEY)
      localStorage.removeItem(AIVIS_KEY)
    }
  } catch {
    /* storage blocked: stays off */
  }
}

interface Speaker {
  name: string
  styles: { name: string; id: number; type?: string }[]
}

/** One engine's talking voices, one per character style, or null if it doesn't answer. */
export async function probeEngine(kind: EngineKind, url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<EngineVoice[] | null> {
  try {
    const res = await fetch(`${url}/speakers`, { signal: AbortSignal.timeout(timeoutMs) })
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

/** Every turned-on engine's voices (AivisSpeech first), and which engines answered. */
export async function probeEngines(urls: Record<EngineKind, string>): Promise<{ voices: EngineVoice[]; up: EngineKind[] }> {
  const order: EngineKind[] = ['aivis', 'voicevox']
  const found = await Promise.all(order.map((k) => probeEngine(k, urls[k])))
  return { voices: found.flatMap((v) => v ?? []), up: order.filter((_, i) => found[i] !== null) }
}

/** One sentence as 24 kHz WAV: the engine's two-step query, then synthesis. */
export async function synthesize(url: string, voice: EngineVoiceId, text: string): Promise<Blob> {
  const speaker = styleOf(voice)
  const signal = AbortSignal.timeout(SYNTH_TIMEOUT_MS)
  const q = await fetch(`${url}/audio_query?${new URLSearchParams({ speaker, text })}`, { method: 'POST', signal })
  if (!q.ok) throw new Error(`audio_query: HTTP ${q.status}`)
  const query = { ...(await q.json()), outputSamplingRate: SAMPLE_RATE }
  const res = await fetch(`${url}/synthesis?${new URLSearchParams({ speaker })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
    signal,
  })
  if (!res.ok) throw new Error(`synthesis: HTTP ${res.status}`)
  const blob = await res.blob()
  return blob.type ? blob : new Blob([blob], { type: 'audio/wav' })
}

export { ENGINES }
