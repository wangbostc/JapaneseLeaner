// Playwright's second web server: the real Worker (API + app) under wrangler dev.
// It waits for the preview server, whose command builds dist/, so the two never build at once.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const previewPort = Number(process.env.E2E_PORT ?? 4173)
const port = Number(process.env.E2E_WORKER_PORT ?? 8789)
while (!(await fetch(`http://localhost:${previewPort}/`).then((r) => r.ok, () => false))) await sleep(500)

const sh = (cmd, args) => new Promise((ok, fail) => spawn(cmd, args, { stdio: 'inherit' }).on('exit', (c) => (c === 0 ? ok() : fail(new Error(`${cmd} ${args[0]} failed`)))))
await sh('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'kikitori', '--local', '--persist-to', '.wrangler/e2e'])
// A fake Anthropic API, so AI routes run end to end without real calls or cost.
const { createServer } = await import('node:http')
const fakeAnthropic = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const json = JSON.parse(body || '{}')
    const msg = { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    if (json.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const events = [
        { type: 'message_start', message: { ...msg, content: [], stop_reason: null } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '（サーバー経由）' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'explained by the server.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ]
      res.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''))
    } else {
      const n = (json.messages?.[0]?.content ?? '').split('\n').length
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...msg, content: [{ type: 'text', text: JSON.stringify({ translations: Array.from({ length: n }, (_, i) => `server translation ${i + 1}`) }) }], stop_reason: 'end_turn' }))
    }
  })
}).listen(0)
const anthropicUrl = `http://127.0.0.1:${fakeAnthropic.address().port}`

// A throwaway VAPID pair so push subscriptions can be tested.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const vapidPublic = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url')
const vapidPrivate = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
const dev = spawn(
  'pnpm',
  [
    'exec', 'wrangler', 'dev', '--port', String(port), '--persist-to', '.wrangler/e2e',
    '--var', 'SETUP_CODE:e2e-sync-setup-code', '--var', `VAPID_PUBLIC_KEY:${vapidPublic}`, '--var', `VAPID_PRIVATE_KEY:${vapidPrivate}`,
    '--var', 'ANTHROPIC_API_KEY:e2e-fake-key', '--var', `ANTHROPIC_BASE_URL:${anthropicUrl}`,
  ],
  { stdio: 'inherit' },
)
process.on('SIGTERM', () => dev.kill('SIGTERM'))
process.on('SIGINT', () => dev.kill('SIGINT'))
dev.on('exit', (code) => (fakeAnthropic.close(), process.exit(code ?? 0)))
