import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { UiLang } from '../lib/db'
import { STRINGS, type Strings } from './i18n'

export interface Settings {
  lang: UiLang
  furigana: boolean
  translation: boolean
  rate: number
  voiceURI?: string
}

const KEY = 'kikitori.settings'

const defaults = (): Settings => ({
  lang: typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en',
  furigana: true,
  translation: true,
  rate: 1,
})

function load(): Settings {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return defaults()
  }
}

interface Ctx {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  t: Strings
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* private mode: settings last for the session */
    }
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en'
  }, [settings])
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))
  return <SettingsContext.Provider value={{ settings, update, t: STRINGS[settings.lang] }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings outside SettingsProvider')
  return ctx
}
