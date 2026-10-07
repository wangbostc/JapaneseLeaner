import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

export interface PickOptions {
  directories?: boolean
  /** The picker's confirm button. */
  prompt?: string
}

/** Files the learner chooses: picked in a dialog (or dropped), read and written. */
export interface Files {
  /** The chosen paths; null if cancelled. */
  pick(options?: PickOptions): Promise<string[] | null>
  readText(path: string): Promise<string>
  /** A file as a Blob of `type`, keeping its name. */
  readBlob(path: string, type: string): Promise<{ blob: Blob; name: string }>
  write(path: string, data: Blob | string): Promise<void>
  exists(path: string): boolean
}

/** Reading and writing with node:fs (Bun and Node); `pick` comes from the window (or a test). */
export function nodeFiles(pick: Files['pick']): Files {
  return {
    pick,
    readText: async (path) => readFileSync(path, 'utf8'),
    readBlob: async (path, type) => ({ blob: new Blob([readFileSync(path)], { type }), name: basename(path) }),
    async write(path, data) {
      writeFileSync(path, typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer()))
    },
    exists: existsSync,
  }
}
