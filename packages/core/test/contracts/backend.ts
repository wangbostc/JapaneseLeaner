import type { Database } from '../../src/database'

/** A storage backend under test: the contracts in this folder run against each one. */
export interface Backend {
  name: string
  /** A fresh, empty database. */
  open(): Database
  /** Removes every database opened so far. */
  cleanup(): Promise<void>
}
