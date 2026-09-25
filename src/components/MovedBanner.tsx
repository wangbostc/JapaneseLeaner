import { useState } from 'react'
import { useSettings } from '../app/useSettings'
import { exportBackup } from '../lib/backup'
import { db } from '../lib/db'

/**
 * Shown by the old static (GitHub Pages) build once the app has a new home. Browser storage
 * belongs to one address, so the learner carries their data over with a backup file.
 * The address comes from VITE_MOVED_TO at build time (a repository variable in CI).
 */
const MOVED_TO: string | undefined = import.meta.env.VITE_MOVED_TO || undefined

export function MovedBanner() {
  const { t, settings } = useSettings()
  const [busy, setBusy] = useState(false)
  if (!MOVED_TO) return null
  const download = async () => {
    setBusy(true)
    try {
      const url = URL.createObjectURL(await exportBackup(db, settings))
      const a = document.createElement('a')
      a.href = url
      a.download = `kikitori-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="moved" role="alert" data-testid="moved-banner">
      <strong>{t.movedTitle}</strong>
      <p>{t.movedBody}</p>
      <div className="row">
        <button className="btn" onClick={download} disabled={busy}>
          {t.movedExport}
        </button>
        <a className="btn primary" href={MOVED_TO}>
          {t.movedOpen} →
        </a>
      </div>
    </div>
  )
}
