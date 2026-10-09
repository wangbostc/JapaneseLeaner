import { DEFAULT_NEW_WORDS_PER_DAY, NEW_WORDS_PER_DAY } from '@kikitori/core/coreWords'
import type { UiLang } from '@kikitori/core/model'
import type { KeyValueStore } from '@kikitori/core/seed'
import { DEFAULT_CARD_MODE, isCardModeSetting, type CardModeSetting } from '@kikitori/core/review'
import { isEngineVoiceId, type EngineVoiceId } from '@kikitori/core/voices'

/** The macOS app's settings so far (the web app's grow as its features arrive here). */
export interface MacSettings {
  lang: UiLang
  furigana: boolean
  translation: boolean
  /** Gaps between 文節 phrases. */
  chunks: boolean
  /** Speaking and playback speed (Slow is 0.7 of it). */
  rate: number
  /** Core-word cards added a day (0: off). */
  newWordsPerDay: number
  /** How flashcards are reviewed (read, listen, recall or a mix); the web app's key. */
  cardMode: CardModeSetting
  /** An AivisSpeech or VOICEVOX voice on this Mac; unset: the Mac's own Japanese voice. */
  voiceURI?: EngineVoiceId
  /** The voice's character, for its credit ("VOICEVOX:<character>"); unset until the engine names it. */
  voiceSpeaker?: string
}

const KEY = 'kikitori.settings'

export const defaultSettings = (locale: string): MacSettings => ({ lang: locale.startsWith('zh') ? 'zh' : 'en', furigana: true, translation: true, chunks: false, rate: 1, newWordsPerDay: DEFAULT_NEW_WORDS_PER_DAY, cardMode: DEFAULT_CARD_MODE })

/** Speeds offered in Settings (Slow plays at 0.7 of the chosen one). */
export const RATES = [0.8, 1, 1.2] as const

/**
 * `saved` over `base`, field by field: a missing or malformed field keeps `base`'s. Used for the
 * prefs file and for a restored backup's settings (a web backup's extra fields are ignored).
 */
export function sanitizeSettings(saved: unknown, base: MacSettings): MacSettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return {
    lang: s.lang === 'en' || s.lang === 'zh' ? s.lang : base.lang,
    furigana: typeof s.furigana === 'boolean' ? s.furigana : base.furigana,
    translation: typeof s.translation === 'boolean' ? s.translation : base.translation,
    chunks: typeof s.chunks === 'boolean' ? s.chunks : base.chunks,
    rate: typeof s.rate === 'number' && s.rate >= 0.5 && s.rate <= 2 ? s.rate : base.rate,
    newWordsPerDay: (NEW_WORDS_PER_DAY as readonly unknown[]).includes(s.newWordsPerDay) ? (s.newWordsPerDay as number) : base.newWordsPerDay,
    cardMode: isCardModeSetting(s.cardMode) ? s.cardMode : base.cardMode,
    ...voiceOf(s),
  }
}

/**
 * The saved engine voice and its character (kept only with its voice). Without one, the Mac's own
 * voice: saved with it, or a web backup's Azure or browser voice, which mean nothing here. Both
 * keys are always there, so a restored backup replaces the current voice rather than merging
 * into it (a web backup's engine voice comes without its character: the app asks its engine).
 */
function voiceOf(s: Record<string, unknown>): Pick<MacSettings, 'voiceURI' | 'voiceSpeaker'> {
  const voiceURI = typeof s.voiceURI === 'string' && isEngineVoiceId(s.voiceURI) ? s.voiceURI : undefined
  const voiceSpeaker = voiceURI && typeof s.voiceSpeaker === 'string' && s.voiceSpeaker ? s.voiceSpeaker : undefined
  return { voiceURI, voiceSpeaker }
}

/** Saved settings over the defaults. */
export function readSettings(prefs: KeyValueStore, locale: string): MacSettings {
  let saved: unknown = {}
  try {
    saved = JSON.parse(prefs.getItem(KEY) ?? '{}')
  } catch {
    // keep the defaults
  }
  return sanitizeSettings(saved, defaultSettings(locale))
}

export function writeSettings(prefs: KeyValueStore, settings: MacSettings) {
  prefs.setItem(KEY, JSON.stringify(settings))
}
