import { useState } from 'react'
import { prepareClips, useNaturalVoices } from '../app/neuralVoice'
import { useSyncStatus } from '../app/sync'
import { useSettings } from '../app/useSettings'
import type { Lesson } from '../lib/db'
import { neuralChoice } from '../lib/speech'
import { engineOf, isEngineVoiceId } from '../lib/voices'
import { VoiceCredit } from './VoiceCredit'

/**
 * On a computer running the chosen voice's engine (AivisSpeech or VOICEVOX): makes the whole lesson in the chosen voice and uploads it, so a
 * phone can play it (offline too, once played there). Lessons with their own audio don't need it.
 */
export function PrepareVoice({ lesson }: { lesson: Lesson }) {
  const { t, settings } = useSettings()
  const natural = useNaturalVoices()
  const sync = useSyncStatus()
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy'; done: number } | { kind: 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const voice = neuralChoice(settings.voiceURI)
  const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
  if (lesson.mediaId || !connected || !voice || !isEngineVoiceId(voice) || !natural.enginesUp.includes(engineOf(voice))) return null
  const total = new Set(lesson.sentences.map((s) => s.text.trim()).filter(Boolean)).size
  const run = async () => {
    setState({ kind: 'busy', done: 0 })
    try {
      await prepareClips(
        lesson.sentences.map((s) => s.text),
        voice,
        (done) => setState({ kind: 'busy', done }),
      )
      setState({ kind: 'done' })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="prepare-voice" data-testid="prepare-voice">
      <div className="row">
        <button className="btn" onClick={run} disabled={state.kind === 'busy'}>
          {state.kind === 'busy' ? t.preparingVoice(state.done, total) : t.prepareVoice}
        </button>
        {state.kind === 'done' && <span className="muted small">{t.preparedVoice}</span>}
        {state.kind === 'error' && (
          <span className="error small" role="alert">
            {t.prepareVoiceFailed} {t.prepareErrors[state.message] ?? state.message}
          </span>
        )}
      </div>
      <VoiceCredit />
    </div>
  )
}
