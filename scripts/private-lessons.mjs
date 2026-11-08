// Puts the learner's private lessons (the local MongoDB's kikitori.privateLessons: a textbook of
// their own, like Genki) on their own local server, so their phone can study them too:
//   node scripts/private-lessons.mjs upload
// Then run `wrangler dev` with PRIVATE_LESSONS=1 in .dev.vars. Each connected device adds them on
// its next start. Local only: the documents go into this computer's .wrangler state, never to
// Cloudflare, the build, or the repo. KIKITORI_MONGO_URL and KIKITORI_MONGO_DB point elsewhere.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'

const WRANGLER = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url))
const BUCKET = 'kikitori-files'
// Must match worker/privateLessons.ts.
const KEY = 'private/lessons.json'

const [cmd, ...rest] = process.argv.slice(2)
if (cmd !== 'upload' || rest.length) throw new Error('usage: node scripts/private-lessons.mjs upload   (to the local server only)')

const url = process.env.KIKITORI_MONGO_URL ?? 'mongodb://127.0.0.1:27017'
const client = new MongoClient(url, { serverSelectionTimeoutMS: 1500 })
let docs
try {
  docs = await client
    .db(process.env.KIKITORI_MONGO_DB ?? 'kikitori')
    .collection('privateLessons')
    .find({}, { projection: { _id: 0 } })
    .sort({ _id: 1 })
    .toArray()
} finally {
  await client.close()
}
// An audio path is a file on this computer, which a phone can't open: those lessons are read aloud.
for (const d of docs) delete d.audio

const dir = mkdtempSync(join(tmpdir(), 'kikitori-private-'))
try {
  const file = join(dir, 'lessons.json')
  writeFileSync(file, JSON.stringify({ docs }))
  execFileSync(WRANGLER, ['r2', 'object', 'put', `${BUCKET}/${KEY}`, '--file', file, '--local', '--content-type', 'application/json'], { stdio: ['ignore', 'ignore', 'inherit'] })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`${docs.length} private lessons put on the local server. Devices add them on their next start.`)
