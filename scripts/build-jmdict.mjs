// Builds public/jmdict/common.json: a compact English dictionary of JMdict's
// common words (~22k entries), lazy-loaded for word meanings, and
// public/jmdict/examples.json: up to two example sentences per entry (from
// JMdict's examples, which come from Tatoeba), in the same order as the
// entries. The sources are jmdict-simplified release assets pinned in
// scripts/jmdict-release.json (see the README's "Updating JMdict" section) and
// verified by checksum.
//
// JMdict is © the Electronic Dictionary Research and Development Group,
// used under CC BY-SA 4.0; the example sentences are Tatoeba's, CC BY 2.0 FR
// — see the About screen and README.
//
// Needs network on first run. Locally a failure only warns (the app then shows
// no meanings); in CI it fails the build so a deploy can't ship without them.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const {
  version: VERSION,
  sha256: SHA256,
  examplesSha256: EXAMPLES_SHA256,
  // The built files' layout: bumped whenever it changes, so built copies and cached ones are
  // replaced even for the same release.
  format: FORMAT,
} = JSON.parse(readFileSync(join(import.meta.dirname, 'jmdict-release.json'), 'utf8'))
const ASSET = `jmdict-eng-common-${VERSION}.json.tgz`
// The whole JMdict with examples (14 MB): only its examples are kept.
const EXAMPLES_ASSET = `jmdict-examples-eng-${VERSION}.json.tgz`
const urlOf = (asset) => `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(VERSION)}/${asset}`

const out = join(root, 'public', 'jmdict', 'common.json')
const examplesOut = join(root, 'public', 'jmdict', 'examples.json')
// One cache folder per release, so a version bump never reads another release's files.
const cache = join(root, 'node_modules', '.cache', 'jmdict', VERSION)

const MAX_SENSES = 3
const MAX_GLOSSES = 4
const MAX_EXAMPLES = 2

/** Whether `file` was built from this release in this format. */
function isCurrent(file) {
  try {
    const { release, format } = JSON.parse(readFileSync(file, 'utf8'))
    return release === VERSION && format === FORMAT
  } catch {
    return false
  }
}

/** The asset's one JSON member, parsed: downloaded (checksum first) unless cached, extracted, then removed. */
async function load(asset, sha256) {
  mkdirSync(cache, { recursive: true })
  const tgz = join(cache, asset)
  if (!existsSync(tgz)) {
    const res = await fetch(urlOf(asset))
    if (!res.ok) throw new Error(`download ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    // Checked before writing, so a bad download never sticks in the cache.
    if (digest !== sha256) throw new Error(`checksum mismatch for ${asset}: ${digest}`)
    writeFileSync(tgz, bytes)
  }
  const members = execFileSync('tar', ['tzf', tgz], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.json'))
  if (members.length !== 1) throw new Error(`expected one JSON file in ${asset}, found ${members.length}`)
  execFileSync('tar', ['xzf', tgz, '-C', cache])
  const data = JSON.parse(readFileSync(join(cache, members[0]), 'utf8'))
  rmSync(join(cache, members[0]))
  return data
}

async function main() {
  if (isCurrent(out) && isCurrent(examplesOut)) return
  const src = await load(ASSET, SHA256)

  const usedTags = new Set()
  const entries = src.words.map((w) => {
    const senses = w.sense.slice(0, MAX_SENSES).map((s) => {
      const pos = s.partOfSpeech.slice(0, 2)
      pos.forEach((p) => usedTags.add(p))
      return [pos, s.gloss.slice(0, MAX_GLOSSES).map((g) => g.text)]
    })
    // Every written form is kept for lookup; the UI shows only the first few. A 1 marks a
    // word usually written in kana (いる is 居る), so a lookup in kana finds it first.
    const kanji = w.kanji.map((k) => k.text)
    const kana = w.kana.map((k) => k.text)
    return w.sense.some((s) => s.misc.includes('uk')) ? [kanji, kana, senses, 1] : [kanji, kana, senses]
  })
  const tags = Object.fromEntries([...usedTags].sort().map((t) => [t, src.tags[t] ?? t]))
  mkdirSync(join(root, 'public', 'jmdict'), { recursive: true })
  writeFileSync(out, JSON.stringify({ release: VERSION, format: FORMAT, version: src.version, dictDate: src.dictDate, tags, entries }))
  console.log(`built ${out}: ${entries.length} entries from ${VERSION}`)

  // Examples, in the order of common.json's entries (matched by JMdict id): for each entry, up to
  // MAX_EXAMPLES from the senses kept above, each [Japanese, English, the word as it appears in
  // the sentence, Tatoeba sentence id, sense index]; 0 for an entry with none.
  const position = new Map(src.words.map((w, i) => [w.id, i]))
  const examples = new Array(entries.length).fill(0)
  for (const w of (await load(EXAMPLES_ASSET, EXAMPLES_SHA256)).words) {
    const i = position.get(w.id)
    if (i === undefined) continue
    const found = w.sense.slice(0, MAX_SENSES).flatMap((s, sense) =>
      (s.examples ?? []).map((e) => {
        const text = (lang) => e.sentences.find((x) => x.lang === lang)?.text
        return [text('jpn'), text('eng'), e.text, Number(e.source.value), sense]
      }),
    )
    const usable = found.filter(([ja, en, form, id]) => ja && en && form && ja.includes(form) && Number.isInteger(id)).slice(0, MAX_EXAMPLES)
    if (usable.length) examples[i] = usable
  }
  writeFileSync(examplesOut, JSON.stringify({ release: VERSION, format: FORMAT, examples }))
  console.log(`built ${examplesOut}: examples for ${examples.filter(Boolean).length} of ${entries.length} entries`)
}

main().catch((e) => {
  if (process.env.CI) {
    console.error(`[jmdict] ${e.message}`)
    process.exit(1)
  }
  console.warn(`[jmdict] skipped (${e.message}); word meanings will be unavailable`)
})
