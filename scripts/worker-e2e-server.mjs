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

// A fake Azure Speech: answers every request with a short silent WAV, so natural voices run end to end.
const wav = (() => {
  const samples = 1600 // 0.2 s at 8 kHz, 8-bit mono
  const b = Buffer.alloc(44 + samples, 128)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28)
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(samples, 40)
  return b
})()
const fakeAzure = createServer((req, res) => {
  req.resume()
  req.on('end', () => (res.writeHead(200, { 'content-type': 'audio/wav' }), res.end(wav)))
}).listen(0)
const azureUrl = `http://127.0.0.1:${fakeAzure.address().port}/cognitiveservices/v1`

// Fake speech engines (what a learner runs on their computer), reachable from the browser:
// VOICEVOX and AivisSpeech, which speaks the same API.
const fakeEngine = (port, speakers) =>
  createServer((req, res) => {
    const cors = { 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' }
    req.resume()
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]
      if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
      if (path === '/speakers') return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(speakers))
      if (path === '/audio_query') return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end('{"speedScale":1,"outputSamplingRate":44100}')
      if (path === '/synthesis') return res.writeHead(200, { ...cors, 'content-type': 'audio/wav' }).end(wav)
      res.writeHead(404, cors).end()
    })
  }).listen(port, '127.0.0.1')
const fakeVoicevox = fakeEngine(Number(process.env.E2E_VOICEVOX_PORT ?? 50121), [
  { name: 'No.7', styles: [{ name: 'ノーマル', id: 29, type: 'talk' }, { name: 'アナウンス', id: 30, type: 'talk' }] },
  { name: '青山龍星', styles: [{ name: 'ノーマル', id: 13, type: 'talk' }] },
])
const fakeAivis = fakeEngine(Number(process.env.E2E_AIVIS_PORT ?? 10111), [
  { name: 'まお', styles: [{ name: 'ノーマル', id: 888753760, type: 'talk' }, { name: 'おちつき', id: 888753763, type: 'talk' }] },
])

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
    '--var', 'AZURE_SPEECH_KEY:e2e-fake-key', '--var', 'AZURE_SPEECH_REGION:e2e', '--var', `AZURE_SPEECH_ENDPOINT:${azureUrl}`,
  ],
  { stdio: 'inherit' },
)
process.on('SIGTERM', () => dev.kill('SIGTERM'))
process.on('SIGINT', () => dev.kill('SIGINT'))
dev.on('exit', (code) => (fakeAnthropic.close(), fakeAzure.close(), fakeVoicevox.close(), fakeAivis.close(), process.exit(code ?? 0)))
