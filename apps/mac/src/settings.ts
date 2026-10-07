import { DEFAULT_NEW_WORDS_PER_DAY, NEW_WORDS_PER_DAY } from '@kikitori/core/coreWords'
import type { UiLang } from '@kikitori/core/model'
import type { KeyValueStore } from '@kikitori/core/seed'

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
}

const KEY = 'kikitori.settings'

export const defaultSettings = (locale: string): MacSettings => ({ lang: locale.startsWith('zh') ? 'zh' : 'en', furigana: true, translation: true, chunks: false, rate: 1, newWordsPerDay: DEFAULT_NEW_WORDS_PER_DAY })

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
  }
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
