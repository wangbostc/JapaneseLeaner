import { useEffect, useState } from 'react'
import { refreshEngine, useNaturalVoices } from '../app/neuralVoice'
import { useSyncStatus } from '../app/sync'
import { useSettings } from '../app/useSettings'
import { DEFAULT_ENGINE_URL, engineUrl, setEngineUrl } from '../app/voicevox'
import { neuralChoice, speak } from '../lib/speech'
import { isVoicevoxId, NEURAL_PREFIX, type NaturalVoiceId } from '../lib/voices'
import { VoiceCredit } from './VoiceCredit'

/** The setting value for a natural voice: Azure voices are prefixed, VOICEVOX ids already are. */
const valueOf = (id: NaturalVoiceId) => (isVoicevoxId(id) ? id : NEURAL_PREFIX + id)

const isLocalOrigin = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)

/** Settings → Japanese voice: natural voices (Azure, VOICEVOX), the device's own, and VOICEVOX on this computer. */
export function VoiceSettings({ voices }: { voices: SpeechSynthesisVoice[] | null }) {
  const { t, settings, update } = useSettings()
  const natural = useNaturalVoices()
  const sync = useSyncStatus()
  const [useEngine, setUseEngine] = useState(() => !!engineUrl())
  const [engine, setEngine] = useState<'checking' | 'up' | 'down' | null>(() => (engineUrl() ? 'checking' : null))

  const check = async () => {
    setEngine('checking')
    setEngine((await refreshEngine()) ? 'up' : 'down')
  }
  useEffect(() => {
    if (engineUrl()) void refreshEngine().then((ok) => setEngine(ok ? 'up' : 'down'))
  }, [])
  const toggle = async (on: boolean) => {
    setUseEngine(on)
    setEngineUrl(on ? DEFAULT_ENGINE_URL : null)
    if (on) await check()
    else {
      await refreshEngine()
      setEngine(null)
    }
  }

  const hasAny = !!voices?.length || !!natural.azure?.length || !!natural.voicevox?.length
  const fallback = neuralChoice(undefined)
  // With natural voices on and nothing chosen, the default natural voice speaks; show that, not the first device voice.
  const value = settings.voiceURI ?? (fallback ? valueOf(fallback) : (voices?.[0]?.voiceURI ?? ''))
  // A VOICEVOX voice chosen earlier but not available now (engine closed, nothing prepared): say so
  // rather than showing whichever option comes first while the device voice speaks.
  const stale = !!settings.voiceURI && isVoicevoxId(settings.voiceURI) && !natural.voicevox?.some((v) => v.id === settings.voiceURI)

  return (
    <>
      <label>
        {t.settingsVoice}
        {!hasAny && voices ? (
          <small className="error">{t.noVoice}</small>
        ) : (
          <select data-testid="voice-select" value={value} onChange={(e) => update({ voiceURI: e.target.value || undefined })}>
            {!!natural.azure?.length && (
              <optgroup label={t.voiceNatural}>
                {natural.azure.map((v) => (
                  <option key={v.id} value={valueOf(v.id)}>
                    {v.name} · {v.gender === 'female' ? t.voiceFemale : t.voiceMale}
                  </option>
                ))}
              </optgroup>
            )}
            {!!natural.voicevox?.length && (
              <optgroup label={natural.engineUp ? t.voiceVoicevoxHere : t.voiceVoicevoxPrepared}>
                {natural.voicevox.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {stale && (
              <option value={settings.voiceURI} disabled>
                {t.voiceUnavailable(settings.voiceURI!)}
              </option>
            )}
            {!!voices?.length && (
              <optgroup label={t.voiceDevice}>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        {!natural.azure?.length && !natural.voicevox?.length && sync.kind !== 'unavailable' && <small className="muted">{t.voiceNaturalHint}</small>}
      </label>
      <VoiceCredit />
      {hasAny && (
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => void speak(t.voiceSample, settings.rate, settings.voiceURI)}>
            {t.voicePreview}
          </button>
        </div>
      )}
      <label className="toggle">
        <input type="checkbox" checked={useEngine} onChange={(e) => void toggle(e.target.checked)} data-testid="voicevox-toggle" />
        {t.voicevoxUse}
      </label>
      {useEngine && engine && (
        <small className={engine === 'down' ? 'error' : 'muted'} data-testid="voicevox-status" aria-live="polite">
          {engine === 'checking'
            ? t.voicevoxChecking
            : engine === 'up'
              ? t.voicevoxFound(natural.voicevox?.length ?? 0, sync.kind !== 'unavailable' && sync.kind !== 'disconnected')
              : t.voicevoxMissing(engineUrl() ?? DEFAULT_ENGINE_URL, isLocalOrigin() ? null : location.origin)}
        </small>
      )}
    </>
  )
}
