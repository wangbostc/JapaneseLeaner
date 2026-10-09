import { createExamples, type Examples, type ExamplesData } from '@kikitori/core/examples'
import { createDictionary, type DictData, type Dictionary } from '@kikitori/core/jmdict'

const json = <T>(file: string): Promise<T | null> =>
  fetch(`${import.meta.env.BASE_URL}jmdict/${file}`)
    .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
    .catch(() => null)

let shared: Promise<Dictionary | null> | null = null

/** The app-wide dictionary, fetched once on first use; null if it isn't available. */
export function getDictionary(): Promise<Dictionary | null> {
  shared ??= json<DictData>('common.json').then((data) => {
    if (!data) shared = null // try again next time
    return data ? createDictionary(data) : null
  })
  return shared
}

let sharedExamples: Promise<Examples | null> | null = null

/**
 * Example sentences, fetched once when first wanted (a flipped card); null if they aren't
 * available or don't match the dictionary.
 */
export function getExamples(): Promise<Examples | null> {
  sharedExamples ??= Promise.all([json<ExamplesData>('examples.json'), getDictionary()]).then(([data, dict]) => {
    if (!data || !dict) sharedExamples = null
    return createExamples(data, dict)
  })
  return sharedExamples
}
