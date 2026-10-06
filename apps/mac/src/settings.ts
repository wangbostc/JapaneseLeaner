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
}

const KEY = 'kikitori.settings'

export const defaultSettings = (locale: string): MacSettings => ({ lang: locale.startsWith('zh') ? 'zh' : 'en', furigana: true, translation: true, chunks: false, rate: 1 })

/** Saved settings over the defaults; a malformed field falls back to its default. */
export function readSettings(prefs: KeyValueStore, locale: string): MacSettings {
  const base = defaultSettings(locale)
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(prefs.getItem(KEY) ?? '{}')
  } catch {
    // keep the defaults
  }
  return {
    lang: saved.lang === 'en' || saved.lang === 'zh' ? saved.lang : base.lang,
    furigana: typeof saved.furigana === 'boolean' ? saved.furigana : base.furigana,
    translation: typeof saved.translation === 'boolean' ? saved.translation : base.translation,
    chunks: typeof saved.chunks === 'boolean' ? saved.chunks : base.chunks,
    rate: typeof saved.rate === 'number' && saved.rate >= 0.5 && saved.rate <= 2 ? saved.rate : base.rate,
  }
}
