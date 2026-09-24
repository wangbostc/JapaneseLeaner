// Builds public/jmdict/common.json: a compact English dictionary of JMdict's
// common words (~22k entries, ~2.5 MB, ~0.8 MB over the wire), lazy-loaded
// for word meanings. Source: jmdict-simplified, pinned and checksum-verified.
//
// JMdict is © the Electronic Dictionary Research and Development Group,
// used under CC BY-SA 4.0 — see the About screen and README.
//
// Needs network on first run; failure is non-fatal (the app then shows no meanings).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '3.6.2+20260921173324'
const ASSET = `jmdict-eng-common-${VERSION}.json.tgz`
const URL = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(VERSION)}/${ASSET}`
const SHA256 = 'db98447ee0b3918ac29f58c95d0b5b0b1e2aeb15f81fbe13d53ee20427028424'

const root = join(import.meta.dirname, '..')
const out = join(root, 'public', 'jmdict', 'common.json')
const cache = join(root, 'node_modules', '.cache', 'jmdict')

const MAX_FORMS = 3
const MAX_SENSES = 3
const MAX_GLOSSES = 4

async function main() {
  if (existsSync(out)) return
  mkdirSync(cache, { recursive: true })
  const tgz = join(cache, ASSET)
  if (!existsSync(tgz)) {
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`download ${res.status}`)
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
  }
  const digest = createHash('sha256').update(readFileSync(tgz)).digest('hex')
  if (digest !== SHA256) throw new Error(`checksum mismatch for ${ASSET}: ${digest}`)
  execFileSync('tar', ['xzf', tgz, '-C', cache])
  const json = readdirSync(cache).find((f) => f.startsWith('jmdict-eng-common') && f.endsWith('.json'))
  const src = JSON.parse(readFileSync(join(cache, json), 'utf8'))

  const usedTags = new Set()
  const entries = src.words.map((w) => {
    const senses = w.sense.slice(0, MAX_SENSES).map((s) => {
      const pos = s.partOfSpeech.slice(0, 2)
      pos.forEach((p) => usedTags.add(p))
      return [pos, s.gloss.slice(0, MAX_GLOSSES).map((g) => g.text)]
    })
    return [w.kanji.slice(0, MAX_FORMS).map((k) => k.text), w.kana.slice(0, MAX_FORMS).map((k) => k.text), senses]
  })
  const tags = Object.fromEntries([...usedTags].sort().map((t) => [t, src.tags[t] ?? t]))
  mkdirSync(join(root, 'public', 'jmdict'), { recursive: true })
  writeFileSync(out, JSON.stringify({ version: src.version, dictDate: src.dictDate, tags, entries }))
  console.log(`built ${out}: ${entries.length} entries`)
}

main().catch((e) => console.warn(`[jmdict] skipped (${e.message}); word meanings will be unavailable`))
