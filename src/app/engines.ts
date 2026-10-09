import { DEFAULT_ENGINE_URLS } from '@kikitori/core/engines'
import { ENGINES, type EngineKind } from '@kikitori/core/voices'

/**
 * Open-source speech engines on this computer: VOICEVOX and AivisSpeech, which speaks the same
 * HTTP API. They are only contacted once the learner turns them on in Settings: a page that probes
 * localhost can trigger the browser's local-network permission prompt, which a phone without an
 * engine should never show. Their HTTP API is in @kikitori/core/engines.
 */

// The switch predates AivisSpeech: `kikitori.voicevox` holds VOICEVOX's address and means "on".
const ON_KEY = 'kikitori.voicevox'
const AIVIS_KEY = 'kikitori.aivis'
export const DEFAULT_URLS: Record<EngineKind, string> = DEFAULT_ENGINE_URLS

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

export { ENGINES }
export { probeEngine, probeEngines, synthesize } from '@kikitori/core/engines'
