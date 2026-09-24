import { createContext, useContext } from 'react'
import type { UiLang } from '../lib/db'
import type { Strings } from './i18n'

export interface Settings {
  lang: UiLang
  furigana: boolean
  translation: boolean
  rate: number
  voiceURI?: string
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
