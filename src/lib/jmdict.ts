import { createDictionary, type DictData, type Dictionary } from '@kikitori/core/jmdict'

let shared: Promise<Dictionary | null> | null = null

/** The app-wide dictionary, fetched once on first use; null if it isn't available. */
export function getDictionary(): Promise<Dictionary | null> {
  shared ??= fetch(`${import.meta.env.BASE_URL}jmdict/common.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: DictData | null) => (data ? createDictionary(data) : null))
    .catch(() => {
      shared = null
      return null
    })
  return shared
}
