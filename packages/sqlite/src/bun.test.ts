// The contracts on bun:sqlite, the macOS app's driver. Only runs under the Bun runtime:
//   bunx --bun vitest run packages/sqlite/src/bun.test.ts
import type { Backend } from '@kikitori/core/test/contracts/backend'
import { backupContract } from '@kikitori/core/test/contracts/backup'
import { coreWordsContract } from '@kikitori/core/test/contracts/coreWords'
import { databaseContract } from '@kikitori/core/test/contracts/database'
import { seedContract } from '@kikitori/core/test/contracts/seed'
import { privateLessonsContract } from '@kikitori/core/test/contracts/privateLessons'
import { storeContract } from '@kikitori/core/test/contracts/store'
import { describe, it } from 'vitest'

const onBun = typeof Bun !== 'undefined'
if (onBun) {
  const { openBunDatabase } = await import('./bun')
  const bun: Backend = { name: 'bun:sqlite', open: () => openBunDatabase(':memory:'), cleanup: async () => {} }
  databaseContract(bun)
  storeContract(bun)
  seedContract(bun)
  privateLessonsContract(bun)
  backupContract(bun)
  coreWordsContract(bun)
} else {
  describe.skip('bun:sqlite (run under Bun: bunx --bun vitest run packages/sqlite/src/bun.test.ts)', () => it('skipped on Node', () => {}))
}
