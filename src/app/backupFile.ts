import { exportBackup } from '@kikitori/core/backup'
import type { Database } from '@kikitori/core/database'
import type { Settings } from './useSettings'

/** Export everything and hand the browser a dated backup file to save. Throws if the export fails. */
export async function downloadBackup(db: Database, settings: Settings): Promise<void> {
  const url = URL.createObjectURL(await exportBackup(db, settings))
  const a = document.createElement('a')
  a.href = url
  a.download = `kikitori-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
