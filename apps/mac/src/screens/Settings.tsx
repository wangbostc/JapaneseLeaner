import { exportBackup, parseBackup, restoreBackup, type Backup } from '@kikitori/core/backup'
import { forgetPrivateLessons } from '@kikitori/core/privateLessons'
import { basename, join } from 'node:path'
import { useEffect, useState } from 'react'
import type { AudioStatus } from '../audio/audio'
import { useApp } from '../context'
import { NEW_WORDS_PER_DAY } from '@kikitori/core/coreWords'
import { RATES, sanitizeSettings } from '../settings'
import { Choice, Field, Toggle } from '../ui/form'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { VoiceSettings } from './VoiceSettings'

/** kikitori-backup-2026-10-06.json, or -2, -3… if that name is taken. */
function backupName(dir: string, exists: (p: string) => boolean, now = new Date()) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  for (let n = 1; ; n++) {
    const path = join(dir, `kikitori-backup-${day}${n > 1 ? `-${n}` : ''}.json`)
    if (!exists(path)) return path
  }
}

export function Settings() {
  const { t, settings, updateSettings, audio, db, files, navigate, prefs } = useApp()
  const [speech, setSpeech] = useState<AudioStatus | null>(null)
  const [pending, setPending] = useState<{ backup: Backup; name: string } | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    audio.status().then((s) => live && setSpeech(s), () => live && setSpeech({ canScore: false, onDevice: false }))
    return () => {
      live = false
    }
  }, [audio])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await task()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  const exportTo = () =>
    run(async () => {
      const dir = (await files.pick({ directories: true, prompt: t.macExportTo }))?.[0]
      if (!dir) return
      const path = backupName(dir, files.exists)
      await files.write(path, await exportBackup(db, settings))
      setMessage({ ok: true, text: t.macExported(path) })
    })
  const chooseRestore = () =>
    run(async () => {
      const path = (await files.pick({ prompt: t.macRestorePick }))?.[0]
      if (!path) return
      setPending({ backup: parseBackup(await files.readText(path)), name: basename(path) })
    })
  const restore = () =>
    run(async () => {
      if (!pending) return
      await restoreBackup(db, pending.backup)
      // The backup's private lessons may be older than MongoDB's: compare them all at next start.
      forgetPrivateLessons(prefs)
      if (pending.backup.settings) updateSettings(sanitizeSettings(pending.backup.settings, settings))
      setPending(null)
      navigate({ name: 'library' }) // what was on screen may be gone
    })

  return (
    <Col style={{ gap: 22 }}>
      <Text size={28} weight={700}>
        {t.navSettings}
      </Text>
      <Field label={t.settingsLang}>
        <Choice
          testId="lang"
          value={settings.lang}
          onChange={(lang) => updateSettings({ lang })}
          options={[
            ['en', 'English'],
            ['zh', '中文'],
          ]}
        />
      </Field>
      <Col style={{ gap: 6 }}>
        <Toggle testId="furigana" label={t.settingsFurigana} on={settings.furigana} onChange={(furigana) => updateSettings({ furigana })} />
        <Toggle testId="translation" label={t.settingsTranslation} on={settings.translation} onChange={(translation) => updateSettings({ translation })} />
        <Toggle testId="chunks" label={t.settingsChunks} on={settings.chunks} onChange={(chunks) => updateSettings({ chunks })} />
      </Col>
      <Field label={t.settingsRate}>
        <Choice testId="rate" value={settings.rate} onChange={(rate) => updateSettings({ rate })} options={RATES.map((r): [number, string] => [r, `${r}×`])} />
      </Field>
      <VoiceSettings />
      <Field label={t.settingsNewWords} hint={t.settingsNewWordsHint}>
        <Choice
          testId="new-words"
          value={settings.newWordsPerDay}
          onChange={(newWordsPerDay) => updateSettings({ newWordsPerDay })}
          options={NEW_WORDS_PER_DAY.map((n): [number, string] => [n, n === 0 ? t.newWordsOff : String(n)])}
        />
      </Field>
      <Field label={t.speechRec}>
        {speech && (
          <Text testId="speech-status" color={speech.canScore ? C.good : C.danger}>
            {speech.canScore ? t.macRecognitionOn(speech.onDevice) : t.macRecognitionOff}
          </Text>
        )}
        {speech && !speech.onDevice && (
          <Text size={12} color={C.dim}>
            {t.macDictationHint}
          </Text>
        )}
      </Field>
      <Field label={`${t.exportData} / ${t.importData}`} hint={t.macBackupHint}>
        <Row style={{ gap: 10 }}>
          <Button testId="export" label={t.exportData} onPress={() => void exportTo()} disabled={busy} />
          <Button testId="restore" label={t.importData} onPress={() => void chooseRestore()} disabled={busy} />
        </Row>
        {pending && (
          <Col testId="restore-confirm" style={{ gap: 8, padding: 14, borderRadius: 10, backgroundColor: C.dangerBg }}>
            <Text>{t.macRestoreFrom(pending.name, pending.backup.lessons.length)}</Text>
            <Text color={C.danger}>{t.confirmRestore}</Text>
            <Row style={{ gap: 8 }}>
              <Button testId="confirm-restore" label={t.importData} variant="danger" onPress={() => void restore()} disabled={busy} />
              <Button testId="cancel-restore" label={t.macCancel} variant="ghost" onPress={() => setPending(null)} />
            </Row>
          </Col>
        )}
        {message && (
          <Text testId="settings-message" color={message.ok ? C.good : C.danger}>
            {message.text}
          </Text>
        )}
      </Field>
    </Col>
  )
}
