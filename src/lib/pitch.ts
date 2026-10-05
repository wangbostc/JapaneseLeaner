import { createAccentTable, type AccentTable } from '@kikitori/core/pitch'

let shared: Promise<AccentTable | null> | null = null

/** The accent table, fetched once on first use; null if it isn't available. */
export function getAccentTable(): Promise<AccentTable | null> {
  shared ??= fetch(`${import.meta.env.BASE_URL}pitch/accents.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data ? createAccentTable(data) : null))
    .catch(() => {
      shared = null
      return null
    })
  return shared
}
