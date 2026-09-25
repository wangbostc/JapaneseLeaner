// Cloudflare static assets are capped per file (25 MiB); the ONNX asyncify runtime is larger.
// `list` (run after every build) writes such files into dist/.assetsignore so the asset
// upload skips them; `upload --local|--remote` puts them in the R2 bucket, from which the
// Worker serves them at the same URL.
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const LIMIT = 25 * 1024 * 1024
const dist = join(import.meta.dirname, '..', 'dist')
const BUCKET = 'kikitori-files'

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

const large = walk(dist)
  .filter((f) => statSync(f).size > LIMIT)
  .map((f) => relative(dist, f))

const [cmd, where] = process.argv.slice(2)
if (cmd === 'list') {
  writeFileSync(join(dist, '.assetsignore'), large.join('\n') + (large.length ? '\n' : ''))
  console.log(`large assets (served from R2): ${large.join(', ') || 'none'}`)
} else if (cmd === 'upload') {
  if (where !== '--local' && where !== '--remote') throw new Error('usage: large-assets.mjs upload --local|--remote')
  for (const file of large) {
    execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'put', `${BUCKET}/${file}`, '--file', join(dist, file), where, '--content-type', 'application/wasm'], {
      stdio: 'inherit',
    })
  }
} else {
  throw new Error('usage: large-assets.mjs list | upload --local|--remote')
}
