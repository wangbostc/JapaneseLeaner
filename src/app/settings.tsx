import { useEffect, useState, type ReactNode } from 'react'
import { STRINGS } from './i18n'
import { sanitizeSettings } from './sanitizeSettings'
import { SettingsContext, type Settings } from './useSettings'

const KEY = 'kikitori.settings'

const defaults = (): Settings => ({
  lang: typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en',
  furigana: true,
  translation: true,
  rate: 1,
})

function load(): Settings {
  try {
    return { ...defaults(), ...sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}')) }
  } catch {
    return defaults()
  }
}

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
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...sanitizeSettings(patch) }))
  return <SettingsContext.Provider value={{ settings, update, t: STRINGS[settings.lang] }}>{children}</SettingsContext.Provider>
}
