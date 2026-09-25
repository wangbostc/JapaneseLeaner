import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import type { Env } from './env'

/**
 * A real local D1 (Miniflare) with the migrations applied, fresh per call.
 * @cloudflare/vitest-pool-workers needs vitest 4; this works with the app's vitest.
 */
export async function testEnv(extra: Partial<Env> = {}) {
  const proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: false })
  const dir = join(import.meta.dirname, '..', 'migrations')
  for (const file of readdirSync(dir).sort()) {
    const statements = readFileSync(join(dir, file), 'utf8')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const sql of statements) await proxy.env.DB.prepare(sql).run()
  }
  const env = { ...proxy.env, ...extra } as Env
  return { env, dispose: () => proxy.dispose() }
}
