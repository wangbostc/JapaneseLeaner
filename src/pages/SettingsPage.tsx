import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { setAiKey, useAiKey } from '../app/aiKey'
import { relativeTime } from '../app/i18n'
import { connect, disconnect, syncNow, useSyncStatus } from '../app/sync'
import { backgroundRemindersOn, enableReminders, registerBackgroundCheck, reminderSupport, type ReminderSupport } from '../app/reminders'
import { sanitizeSettings } from '../app/sanitizeSettings'
import { Link } from 'react-router-dom'
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
  const [caps, setCaps] = useState<ReminderSupport | null>(null)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    'Notification' in window ? Notification.permission : 'unsupported',
  )
  const [background, setBackground] = useState(false)
  useEffect(() => {
    reminderSupport().then(setCaps)
    backgroundRemindersOn().then(setBackground)
  }, [])
  const turnOnReminders = async () => {
    const r = await enableReminders()
    setPermission(r.permission)
    setBackground(r.background)
  }
  const sync = useSyncStatus()
  const [setupCode, setSetupCode] = useState('')
  const [deviceName, setDeviceName] = useState(() => (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computer'))
  const [connectError, setConnectError] = useState('')
  const connectDevice = async () => {
    setConnectError('')
    const r = await connect(setupCode, deviceName.trim())
    if (r.ok) setSetupCode('')
    else setConnectError(r.message)
  }
  const aiKey = useAiKey()
  const [keyDraft, setKeyDraft] = useState('')
  const [keySaved, setKeySaved] = useState(false)

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
      <label className="toggle">
        <input type="checkbox" checked={settings.chunks} onChange={(e) => update({ chunks: e.target.checked })} />
        {t.settingsChunks}
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

      {sync.kind !== 'unavailable' && (
        <section className="form" data-testid="sync-section" aria-labelledby="sync-title">
          <h2 className="section-label" id="sync-title">
            {t.syncTitle}
          </h2>
          <p className="muted small">{t.syncHint}</p>
          {sync.kind === 'disconnected' ? (
            <>
              <label>
                {t.syncSetupCode}
                <input type="password" autoComplete="off" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} />
              </label>
              <label>
                {t.syncDeviceName}
                <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} maxLength={80} />
              </label>
              <button className="btn primary" disabled={!setupCode || !deviceName.trim()} onClick={connectDevice}>
                {t.syncConnect}
              </button>
              {connectError && <p className="error small">{connectError}</p>}
            </>
          ) : (
            <>
              <p className="ok small">{t.syncConnected(sync.device)}</p>
              <p className="muted small" role="status" data-testid="sync-status">
                {sync.kind === 'syncing' ? t.syncing : sync.lastSyncedAt ? t.syncLast(relativeTime(settings.lang, sync.lastSyncedAt)) : t.syncNever}
                {sync.kind === 'error' && <span className="error"> {t.syncFailed}</span>}
              </p>
              <div className="row">
                <button className="btn" onClick={() => void syncNow()} disabled={sync.kind === 'syncing'}>
                  {t.syncNow}
                </button>
                <button className="btn" onClick={() => void disconnect()}>
                  {t.syncDisconnect}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <h2 className="section-label">{t.remindersTitle}</h2>
      <p className="muted small">{t.remindersHint}</p>
      {permission === 'default' && (
        <button className="btn" onClick={turnOnReminders} data-testid="enable-reminders">
          {t.enableReminders}
        </button>
      )}
      {permission === 'granted' && <p className="ok small">{t.remindersOn}</p>}
      {permission === 'denied' && <p className="error small">{t.remindersDenied}</p>}
      {caps && (
        <ul className="support" data-testid="reminder-support">
          <li>
            <span>{t.reminderCalendar}</span>
            <span className="ok">{t.supported}</span>
          </li>
          <li>
            <span>{t.reminderBadge}</span>
            <span className={caps.badge ? 'ok' : 'error'}>{caps.badge ? t.supported : t.unsupported}</span>
          </li>
          <li>
            <span>
              {t.reminderBackground}
              <br />
              <small className="muted">{t.reminderBackgroundNote}</small>
            </span>
            {background ? (
              <span className="ok">{t.reminderBackgroundOn}</span>
            ) : caps.periodicSync && permission === 'granted' ? (
              <button className="btn" onClick={async () => setBackground(await registerBackgroundCheck())} data-testid="enable-background">
                {t.reminderBackgroundEnable}
              </button>
            ) : (
              <span className="error">{t.unsupported}</span>
            )}
          </li>
        </ul>
      )}

      <h2 className="section-label">{t.aiTitle}</h2>
      <p className="muted small">{t.aiHint}</p>
      {aiKey ? (
        <div className="row">
          <code className="key-mask">{`${aiKey.slice(0, 7)}…${aiKey.slice(-4)}`}</code>
          <button className="btn" onClick={() => (setAiKey(''), setKeySaved(false))}>
            {t.aiClear}
          </button>
        </div>
      ) : (
        <label>
          {t.aiKeyLabel}
          <input type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="sk-ant-…" />
          <button
            className="btn"
            disabled={!keyDraft.trim()}
            onClick={() => {
              setAiKey(keyDraft.trim())
              setKeyDraft('')
              setKeySaved(true)
            }}
          >
            {t.aiSave}
          </button>
        </label>
      )}
      {keySaved && aiKey && <p className="ok small">{t.aiSaved}</p>}
      <p className="muted small">{t.aiKeyWarning}</p>

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
      <Link to="/about" className="btn ghost back-link">
        {t.about} →
      </Link>
    </div>
  )
}
