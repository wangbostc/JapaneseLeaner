import { useEffect, useState } from 'react'
import { useSettings } from '../app/settings'
import { japaneseVoices, recognitionSupported, recordingSupported, ttsSupported } from '../lib/speech'

export function SettingsPage() {
  const { t, settings, update } = useSettings()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  useEffect(() => {
    japaneseVoices().then(setVoices)
  }, [])

  const support: [string, boolean][] = [
    [t.speechRec, recognitionSupported()],
    [t.micRec, recordingSupported()],
    [t.tts, ttsSupported() && !!voices?.length],
  ]

  return (
    <div className="page form">
      <h1>{t.navSettings}</h1>
      <label>
        {t.settingsLang}
        <select value={settings.lang} onChange={(e) => update({ lang: e.target.value as 'en' | 'zh' })}>
          <option value="en">English</option>
          <option value="zh">简体中文</option>
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.furigana} onChange={(e) => update({ furigana: e.target.checked })} />
        {t.settingsFurigana}
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.translation} onChange={(e) => update({ translation: e.target.checked })} />
        {t.settingsTranslation}
      </label>
      <label>
        {t.settingsRate}: {settings.rate.toFixed(2)}×
        <input type="range" min={0.6} max={1.4} step={0.05} value={settings.rate} onChange={(e) => update({ rate: Number(e.target.value) })} />
      </label>
      <label>
        {t.settingsVoice}
        {voices && voices.length === 0 ? (
          <small className="error">{t.noVoice}</small>
        ) : (
          <select value={settings.voiceURI ?? ''} onChange={(e) => update({ voiceURI: e.target.value || undefined })}>
            {voices?.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </label>

      <h2 className="section-label">{t.support}</h2>
      <ul className="support">
        {support.map(([name, ok]) => (
          <li key={name}>
            <span>{name}</span>
            <span className={ok ? 'ok' : 'error'}>{ok ? t.supported : t.unsupported}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
