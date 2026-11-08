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
  const choice = neuralChoice(settings.voiceURI)
  const voice = choice && isEngineVoiceId(choice) ? choice : null
  const connected = sync.kind === 'idle' || sync.kind === 'syncing' || sync.kind === 'error'
  const ready = connected && !!voice && natural.enginesUp.includes(engineOf(voice))
  // How the last run ended, while it's still about the chosen voice.
  const ended = (job.kind === 'done' || job.kind === 'error') && job.voice === voice ? job : null
  // For a computer that can prepare; a run, and how it ended, stay shown if the engine or the
  // connection goes away meanwhile (not once another kind of voice is chosen).
  if (!lessons || (!ready && job.kind !== 'running' && !ended)) return null
  const count = preparable(lessons).length
  if (!count && job.kind === 'idle') return null
  const name = (id: string) => natural.engineVoices?.find((v) => v.id === id)?.name ?? id

  if (job.kind === 'running') {
    return (
      <section className="prepare-all" data-testid="prepare-all">
        <div className="row prepare-all-head">
          <span className="small">{t.preparingAll(job.progress.done, job.progress.total)}</span>
          <button className="btn" onClick={stopPrepareAll}>
            {t.stopPreparing}
          </button>
        </div>
        <progress max={job.progress.total || 1} value={job.progress.done} aria-label={`${t.prepareAll}: ${name(job.voice)}`} />
      </section>
    )
  }
  return (
    <section className="prepare-all" data-testid="prepare-all">
      <button className="btn" onClick={() => voice && void prepareAll(lessons, voice)} disabled={!ready}>
        {t.prepareAll}
      </button>
      {!ended && voice && <p className="muted small">{t.prepareAllHint(name(voice), count)}</p>}
      {ended?.kind === 'done' && (
        <p className="small" role="status">
          {ended.stopped
            ? t.preparedAllStopped(ended.progress.done, ended.progress.total) + (ended.progress.failed > 0 ? ` ${t.preparedSomeFailed(ended.progress.failed)}` : '')
            : ended.progress.failed > 0
              ? t.preparedAllFailed(ended.lessons, ended.progress.failed)
              : t.preparedAll(ended.lessons)}
        </p>
      )}
      {ended?.kind === 'error' && (
        <p className="error small" role="alert">
          {t.prepareVoiceFailed} {t.prepareErrors[ended.message] ?? ended.message}
        </p>
      )}
    </section>
  )
}
