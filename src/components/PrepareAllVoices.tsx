import { useLiveQuery } from 'dexie-react-hooks'
import { useNaturalVoices } from '../app/neuralVoice'
import { prepareAll, preparable, stopPrepareAll, usePrepareAll } from '../app/prepareAll'
import { useSyncStatus } from '../app/sync'
import { useSettings } from '../app/useSettings'
import { db } from '../lib/db'
import { neuralChoice } from '../lib/speech'
import { engineOf, isEngineVoiceId } from '@kikitori/core/voices'

/**
 * On a computer running the chosen voice's engine: one button that prepares every lesson read
 * aloud, for the learner's other devices (each lesson page has its own button too).
 */
export function PrepareAllVoices() {
  const { t, settings } = useSettings()
  const natural = useNaturalVoices()
  const sync = useSyncStatus()
  const job = usePrepareAll()
  const lessons = useLiveQuery(() => db.lessons.toArray(), [])
  const voice = neuralChoice(settings.voiceURI)
  const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
  const ready = connected && !!voice && isEngineVoiceId(voice) && natural.enginesUp.includes(engineOf(voice))
  // A run carries on (and stays shown) even if the voice or engine changes meanwhile.
  if (!lessons || (!ready && job.kind !== 'running')) return null
  const count = preparable(lessons).length
  if (!count && job.kind !== 'running') return null
  const name = (id: string) => natural.engineVoices?.find((v) => v.id === id)?.name ?? id

  return (
    <section className="prepare-all" data-testid="prepare-all" aria-live="polite">
      {job.kind === 'running' ? (
        <>
          <div className="row prepare-all-head">
            <span className="small">{t.preparingAll(job.progress.done, job.progress.total)}</span>
            <button className="btn" onClick={stopPrepareAll}>
              {t.stopPreparing}
            </button>
          </div>
          <progress max={job.progress.total || 1} value={job.progress.done} aria-label={name(job.voice)} />
        </>
      ) : (
        <>
          <button className="btn" onClick={() => ready && isEngineVoiceId(voice!) && void prepareAll(lessons, voice)} disabled={!ready}>
            {t.prepareAll}
          </button>
          {job.kind === 'idle' && <p className="muted small">{t.prepareAllHint(name(voice!), count)}</p>}
          {job.kind === 'done' && (
            <p className="small">
              {job.stopped ? t.preparedAllStopped(job.progress.done, job.progress.total) : t.preparedAll(job.lessons)}
              {job.progress.failed > 0 && ` ${t.preparedAllFailed(job.progress.failed)}`}
            </p>
          )}
          {job.kind === 'error' && (
            <p className="error small" role="alert">
              {t.prepareVoiceFailed} {t.prepareErrors[job.message] ?? job.message}
            </p>
          )}
        </>
      )}
    </section>
  )
}
