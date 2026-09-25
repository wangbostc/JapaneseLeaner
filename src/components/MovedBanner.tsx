import { useId, useState } from 'react'
import { downloadBackup } from '../app/backupFile'
import { useSettings } from '../app/useSettings'
import { db } from '../lib/db'
import { movedTarget } from '../lib/movedTarget'

/**
 * Shown by the old static (GitHub Pages) build once the app has a new home. Browser storage
 * belongs to one address, so the learner carries their data over with a backup file.
 * The address comes from VITE_MOVED_TO at build time (a repository variable in CI); the
 * build fails if it is set but isn't an http(s) URL (vite.config.ts).
 */
const MOVED_TO = movedTarget(import.meta.env.VITE_MOVED_TO)

export function MovedBanner({ to = MOVED_TO }: { to?: string }) {
  const { t, settings } = useSettings()
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!to) return null
  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      await downloadBackup(db, settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="moved" aria-labelledby={titleId} data-testid="moved-banner">
      <strong id={titleId}>{t.movedTitle}</strong>
      <p>{t.movedBody}</p>
      <div className="row">
        <button className="btn" onClick={download} disabled={busy}>
          {t.movedExport}
        </button>
        <a className="btn primary" href={to}>
          {t.movedOpen} →
        </a>
      </div>
      {error && (
        <p className="error" role="alert">
          {t.movedExportFailed} {error}
        </p>
      )}
    </section>
  )
}
