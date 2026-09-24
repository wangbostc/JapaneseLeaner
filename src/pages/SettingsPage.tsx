import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { sanitizeSettings } from '../app/sanitizeSettings'
import { useSettings } from '../app/useSettings'
import { exportBackup, parseBackup, restoreBackup, type Backup } from '../lib/backup'
import { db } from '../lib/db'
import { japaneseVoices, recognitionSupported, recordingSupported, ttsSupported } from '../lib/speech'

export function SettingsPage() {
  const { t, settings, update } = useSettings()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  const [pending, setPending] = useState<Backup | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const download = async () => {
    try {
      const blob = await exportBackup(db, settings)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kikitori-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setPending(parseBackup(await file.text()))
      setMessage(null)
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  const restore = async () => {
    if (!pending) return
    try {
      await restoreBackup(db, pending)
      update(sanitizeSettings(pending.settings))
      setMessage({ ok: true, text: t.restored(pending.lessons.length) })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
    setPending(null)
  }
  useEffect(() => {
    japaneseVoices().then(setVoices)
  }, [])

  const support: [string, boolean][] = [
    [t.speechRec, recognitionSupported()],
    [t.micRec, recordingSupported()],
    [t.tts, ttsSupported() && !!voices?.length],
    [t.offlineLabel, 'serviceWorker' in navigator],
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

      <h2 className="section-label">{t.dataTitle}</h2>
      <p className="muted small">{t.dataHint}</p>
      <div className="row">
        <button className="btn" onClick={download}>
          {t.exportData}
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          {t.importData}
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={choose} data-testid="restore-input" />
      </div>
      {pending && (
        <div className="self-rate" role="alert">
          <p>{t.confirmRestore}</p>
          <div className="row">
            <button className="btn danger confirm" onClick={restore}>
              {t.importData}
            </button>
            <button className="btn" onClick={() => setPending(null)}>
              {t.back}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={message.ok ? 'ok' : 'error'} role="status">
          {message.text}
        </p>
      )}

      <h2 className="section-label">{t.support}</h2>
      <ul className="support">
        {support.map(([name, ok]) => (
          <li key={name}>
            <span>{name}</span>
            <span className={ok ? 'ok' : 'error'}>{ok ? t.supported : t.unsupported}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">{t.offlineReady}</p>
    </div>
  )
}
