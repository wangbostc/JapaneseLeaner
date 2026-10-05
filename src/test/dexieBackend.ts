import type { Backend } from '@kikitori/core/test/contracts/backend'
import { KikitoriDB } from '../lib/db'
import { dexieDatabase } from '../lib/dexieDatabase'

/** Fresh IndexedDB databases (fake-indexeddb in tests) behind the shared Database interface. */
export function dexieBackend(): Backend {
  const opened: KikitoriDB[] = []
  let n = 0
  return {
    name: 'Dexie',
    open() {
      const db = new KikitoriDB(`test-${n++}-${Math.random()}`)
      opened.push(db)
      return dexieDatabase(db)
    },
    cleanup: async () => void (await Promise.all(opened.splice(0).map((db) => db.delete()))),
  }
}
