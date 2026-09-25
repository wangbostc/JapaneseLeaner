// Starts the built app under `wrangler dev` (local D1, no Cloudflare account needed) and checks
// that the Worker serves both the React app and the API. Run after `pnpm build`.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const port = Number(process.env.WORKER_PORT ?? 8788)
const base = `http://localhost:${port}`
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit' })
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler ${args[0]} exited ${code}`))))
  })

await run(['d1', 'migrations', 'apply', 'kikitori', '--local'])
await new Promise((resolve, reject) =>
  spawn('node', ['scripts/large-assets.mjs', 'upload', '--local'], { stdio: 'inherit' }).on('exit', (c) => (c === 0 ? resolve() : reject(new Error('upload failed')))),
)
const dev = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(port), '--var', 'SETUP_CODE:smoke-test-setup-code'], { stdio: 'ignore' })
try {
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await fetch(`${base}/api/health`).then((r) => r.ok, () => false)
    if (!ready) await sleep(500)
  }
  if (!ready) throw new Error('worker did not start')
  const html = await (await fetch(`${base}/`)).text()
  if (!html.includes('<div id="root">')) throw new Error('app shell not served')
  const sw = await fetch(`${base}/sw.js`)
  if (!sw.ok) throw new Error('service worker not served')
  // The oversized ONNX runtime comes from R2 through the Worker, at its normal URL.
  const { readFileSync } = await import('node:fs')
  const large = readFileSync('dist/.assetsignore', 'utf8').split('\n').filter(Boolean)
  for (const file of large) {
    const res = await fetch(`${base}/${file}`)
    if (!res.ok || res.headers.get('content-type') !== 'application/wasm') throw new Error(`large asset ${file}: ${res.status} ${res.headers.get('content-type')}`)
  }
  const unauth = await fetch(`${base}/api/me`)
  if (unauth.status !== 401) throw new Error(`expected 401 from /api/me, got ${unauth.status}`)
  const reg = await fetch(`${base}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupCode: 'smoke-test-setup-code', name: 'smoke' }),
  })
  const { token } = await reg.json()
  const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  if (!me.ok) throw new Error(`device token rejected: ${me.status}`)
  console.log(`worker smoke: app shell, service worker, ${large.length} R2-served asset(s) and authenticated API all OK`)
} finally {
  dev.kill()
}
