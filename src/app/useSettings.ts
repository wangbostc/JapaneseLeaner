import { createContext, useContext } from 'react'
import type { UiLang } from '@kikitori/core/model'
import type { Strings } from '@kikitori/core/i18n'
import type { CardModeSetting } from '@kikitori/core/review'

export interface Settings {
  lang: UiLang
  furigana: boolean
  translation: boolean
  /** Show 文節/意群 divisions in sentences. */
  chunks: boolean
  rate: number
  voiceURI?: string
  /** Core-word cards added a day (0: off). */
  newWordsPerDay: number
  /** How flashcards are reviewed (read, listen, recall or a mix). */
  cardMode: CardModeSetting
}

export interface SettingsCtx {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  t: Strings
}

export const SettingsContext = createContext<SettingsCtx | null>(null)

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings outside SettingsProvider')
  return ctx
}
