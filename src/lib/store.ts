import { createStore } from '@kikitori/core/store'
import { db } from './db'
import { dexieDatabase } from './dexieDatabase'

/** This device's database, through the interface the shared logic (sync, backup, seed) uses. */
export const database = dexieDatabase(db)
export const store = createStore(database)
