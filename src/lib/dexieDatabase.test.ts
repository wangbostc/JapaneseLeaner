import { backupContract } from '@kikitori/core/test/contracts/backup'
import { coreWordsContract } from '@kikitori/core/test/contracts/coreWords'
import { databaseContract } from '@kikitori/core/test/contracts/database'
import { seedContract } from '@kikitori/core/test/contracts/seed'
import { storeContract } from '@kikitori/core/test/contracts/store'
import { dexieBackend } from '../test/dexieBackend'

const dexie = dexieBackend()
databaseContract(dexie)
storeContract(dexie)
seedContract(dexie)
backupContract(dexie)
coreWordsContract(dexie)
