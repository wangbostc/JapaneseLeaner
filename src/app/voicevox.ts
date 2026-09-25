import { VOICEVOX_PREFIX, type VoicevoxVoice, type VoicevoxVoiceId } from '../lib/voices'

/**
 * The VOICEVOX engine (open-source Japanese TTS) on this computer. It is only contacted once
 * the learner turns it on in Settings: a page that probes localhost can trigger the browser's
 * local-network permission prompt, which a phone without the engine should never show.
 */

const URL_KEY = 'kikitori.voicevox'
export const DEFAULT_ENGINE_URL = 'http://127.0.0.1:50021'
const PROBE_TIMEOUT_MS = 2000
const SYNTH_TIMEOUT_MS = 30_000

/** The engine address when VOICEVOX is turned on for this device, else null. */
export function engineUrl(): string | null {
  try {
    return localStorage.getItem(URL_KEY)
  } catch {
    return null
  }
}

export function setEngineUrl(url: string | null) {
  try {
    if (url) localStorage.setItem(URL_KEY, url.replace(/\/+$/, ''))
    else localStorage.removeItem(URL_KEY)
  } catch {
    /* storage blocked: stays off */
  }
}

interface Speaker {
  name: string
  styles: { name: string; id: number; type?: string }[]
}

/** The engine's talking voices, one per character style, or null if it doesn't answer. */
export async function probeEngine(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<VoicevoxVoice[] | null> {
  try {
    const res = await fetch(`${url}/speakers`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const speakers = (await res.json()) as Speaker[]
    return speakers.flatMap((sp) =>
      sp.styles
        .filter((st) => (st.type ?? 'talk') === 'talk')
        .map((st) => ({ id: `${VOICEVOX_PREFIX}${st.id}` as VoicevoxVoiceId, name: `${sp.name}（${st.name}）`, speaker: sp.name })),
    )
  } catch {
    return null
  }
}

/** One sentence as 24 kHz WAV: the engine's two-step query, then synthesis. */
export async function synthesize(url: string, voice: VoicevoxVoiceId, text: string): Promise<Blob> {
  const speaker = voice.slice(VOICEVOX_PREFIX.length)
  const signal = AbortSignal.timeout(SYNTH_TIMEOUT_MS)
  const q = await fetch(`${url}/audio_query?${new URLSearchParams({ speaker, text })}`, { method: 'POST', signal })
  if (!q.ok) throw new Error(`VOICEVOX audio_query: HTTP ${q.status}`)
  const query = await q.json()
  const res = await fetch(`${url}/synthesis?${new URLSearchParams({ speaker })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
    signal,
  })
  if (!res.ok) throw new Error(`VOICEVOX synthesis: HTTP ${res.status}`)
  const blob = await res.blob()
  return blob.type ? blob : new Blob([blob], { type: 'audio/wav' })
}
