// Builds public/jmdict/common.json: a compact English dictionary of JMdict's
// common words (~22k entries), lazy-loaded for word meanings. The source is a
// jmdict-simplified release pinned in scripts/jmdict-release.json (see the
// README's "Updating JMdict" section) and verified by checksum.
//
// JMdict is © the Electronic Dictionary Research and Development Group,
// used under CC BY-SA 4.0 — see the About screen and README.
//
// Needs network on first run. Locally a failure only warns (the app then shows
// no meanings); in CI it fails the build so a deploy can't ship without them.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const { version: VERSION, sha256: SHA256 } = JSON.parse(readFileSync(join(import.meta.dirname, 'jmdict-release.json'), 'utf8'))
const ASSET = `jmdict-eng-common-${VERSION}.json.tgz`
const URL = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(VERSION)}/${ASSET}`

const out = join(root, 'public', 'jmdict', 'common.json')
// One cache folder per release, so a version bump never reads another release's files.
const cache = join(root, 'node_modules', '.cache', 'jmdict', VERSION)

const MAX_SENSES = 3
const MAX_GLOSSES = 4

function builtRelease() {
  try {
    return JSON.parse(readFileSync(out, 'utf8')).release
  } catch {
    return null
  }
}

async function main() {
  if (builtRelease() === VERSION) return
  mkdirSync(cache, { recursive: true })
  const tgz = join(cache, ASSET)
  if (!existsSync(tgz)) {
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`download ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    // Checked before writing, so a bad download never sticks in the cache.
    if (digest !== SHA256) throw new Error(`checksum mismatch for ${ASSET}: ${digest}`)
    writeFileSync(tgz, bytes)
  }
  const members = execFileSync('tar', ['tzf', tgz], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.json'))
  if (members.length !== 1) throw new Error(`expected one JSON file in ${ASSET}, found ${members.length}`)
  execFileSync('tar', ['xzf', tgz, '-C', cache])
  const src = JSON.parse(readFileSync(join(cache, members[0]), 'utf8'))

  const usedTags = new Set()
  const entries = src.words.map((w) => {
    const senses = w.sense.slice(0, MAX_SENSES).map((s) => {
      const pos = s.partOfSpeech.slice(0, 2)
      pos.forEach((p) => usedTags.add(p))
      return [pos, s.gloss.slice(0, MAX_GLOSSES).map((g) => g.text)]
    })
    // Every written form is kept for lookup; the UI shows only the first few.
    return [w.kanji.map((k) => k.text), w.kana.map((k) => k.text), senses]
  })
  const tags = Object.fromEntries([...usedTags].sort().map((t) => [t, src.tags[t] ?? t]))
  mkdirSync(join(root, 'public', 'jmdict'), { recursive: true })
  writeFileSync(out, JSON.stringify({ release: VERSION, version: src.version, dictDate: src.dictDate, tags, entries }))
  rmSync(join(cache, members[0]))
  console.log(`built ${out}: ${entries.length} entries from ${VERSION}`)
}

main().catch((e) => {
  if (process.env.CI) {
    console.error(`[jmdict] ${e.message}`)
    process.exit(1)
  }
  console.warn(`[jmdict] skipped (${e.message}); word meanings will be unavailable`)
})
