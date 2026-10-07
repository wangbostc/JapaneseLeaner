import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { KeyValueStore } from '@kikitori/core/seed'

/**
 * Small values (settings, which starter lessons were added) in a JSON file. Read once at
 * start, so reads are synchronous like localStorage; every write goes to disk atomically.
 */
export function filePrefs(path: string): KeyValueStore {
  let values: Record<string, string> = {}
  try {
    if (existsSync(path)) values = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    values = {} // unreadable: start over rather than refuse to open
  }
  return {
    getItem: (key) => values[key] ?? null,
    setItem(key, value) {
      values = { ...values, [key]: value }
      mkdirSync(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify(values, null, 2))
      renameSync(tmp, path)
    },
  }
}

/** The same, in memory: for tests. */
export function memoryPrefs(initial: Record<string, string> = {}): KeyValueStore {
  const values = new Map(Object.entries(initial))
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, v) }
}
