// Playwright's second web server: the real Worker (API + app) under wrangler dev.
// It waits for the preview server, whose command builds dist/, so the two never build at once.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const previewPort = Number(process.env.E2E_PORT ?? 4173)
const port = Number(process.env.E2E_WORKER_PORT ?? 8789)
while (!(await fetch(`http://localhost:${previewPort}/`).then((r) => r.ok, () => false))) await sleep(500)

const sh = (cmd, args) => new Promise((ok, fail) => spawn(cmd, args, { stdio: 'inherit' }).on('exit', (c) => (c === 0 ? ok() : fail(new Error(`${cmd} ${args[0]} failed`)))))
await sh('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'kikitori', '--local', '--persist-to', '.wrangler/e2e'])
const dev = spawn(
  'pnpm',
  ['exec', 'wrangler', 'dev', '--port', String(port), '--persist-to', '.wrangler/e2e', '--var', 'SETUP_CODE:e2e-sync-setup-code'],
  { stdio: 'inherit' },
)
process.on('SIGTERM', () => dev.kill('SIGTERM'))
process.on('SIGINT', () => dev.kill('SIGINT'))
dev.on('exit', (code) => process.exit(code ?? 0))
