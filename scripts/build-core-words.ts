// Builds packages/core/src/coreWords.json: the 3,500 most frequent Japanese words, for the
// "core words" flashcards. Run by hand when updating (the output is committed):
//
//   bun scripts/build-core-words.ts
//
// Frequencies come from wordfreq (Robyn Speer; Wikipedia, subtitles, web text, Twitter and
// Reddit, through about 2021), CC BY-SA 4.0 — so the list is CC BY-SA 4.0 too (see
// packages/core/src/coreWords-LICENSE.txt). wordfreq counts surface forms (食べ, 行っ), so each
// is folded into its dictionary form with the app's own tokenizer, and only words that are
// common JMdict entries are kept, so every card has meanings and a reading.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { decode } from '@msgpack/msgpack'
import { toHiragana } from '../packages/core/src/kana'
import { testAnalyzer } from '../packages/core/test/analyzer'

const root = join(import.meta.dir, '..')
const COUNT = 3500
/** How far down wordfreq's list to read: well past 3,500, since most surfaces fold or drop. */
const SURFACES = 60_000

const WORDFREQ = {
  url: 'https://raw.githubusercontent.com/rspeer/wordfreq/v3.2/wordfreq/data/large_ja.msgpack.gz',
  sha256: 'e6ab743b939c1802fc03791f1d58dee2861e822ceecdcdee3f0e05b863ef26d8',
}
const { version: JMDICT_VERSION, sha256: JMDICT_SHA256 } = JSON.parse(readFileSync(join(import.meta.dir, 'jmdict-release.json'), 'utf8'))
const JMDICT_ASSET = `jmdict-eng-common-${JMDICT_VERSION}.json.tgz`
const JMDICT_URL = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(JMDICT_VERSION)}/${JMDICT_ASSET}`

/** A pinned download, cached and checked by sha256. */
async function fetchPinned(url: string, sha256: string, path: string): Promise<Buffer> {
  if (!existsSync(path)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download ${url}: ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== sha256) throw new Error(`checksum mismatch for ${url}: ${digest}`)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, bytes)
  }
  return readFileSync(path)
}

interface JmEntry {
  id: string
  kanji: { common: boolean; text: string }[]
  kana: { common: boolean; text: string }[]
  sense: { partOfSpeech: string[]; misc: string[] }[]
}

// --- Sources ------------------------------------------------------------------------------

const cache = join(root, 'node_modules', '.cache')
const wf = decode(gunzipSync(await fetchPinned(WORDFREQ.url, WORDFREQ.sha256, join(cache, 'wordfreq', 'v3.2-large_ja.msgpack.gz')))) as unknown[]
if ((wf[0] as { format?: string }).format !== 'cB') throw new Error('unexpected wordfreq format')

const jmDir = join(cache, 'jmdict', JMDICT_VERSION)
const tgz = join(jmDir, JMDICT_ASSET)
await fetchPinned(JMDICT_URL, JMDICT_SHA256, tgz)
const member = execFileSync('tar', ['tzf', tgz], { encoding: 'utf8' }).split('\n').find((f) => f.endsWith('.json'))!
if (!existsSync(join(jmDir, member))) execFileSync('tar', ['xzf', tgz, '-C', jmDir])
const jmdict: JmEntry[] = JSON.parse(readFileSync(join(jmDir, member), 'utf8')).words

/** Entries by exact spelling (kanji or kana, as written). */
const bySpelling = new Map<string, JmEntry[]>()
for (const e of jmdict) for (const s of [...e.kanji, ...e.kana]) bySpelling.set(s.text, [...(bySpelling.get(s.text) ?? []), e])

// --- Fold surface forms into dictionary forms -----------------------------------------------

const analyzer = await testAnalyzer()
/** kuromoji's parts of speech that are vocabulary (not grammar, names or numbers). */
const VOCABULARY: Record<string, (detail: string) => boolean> = {
  名詞: (d) => !['固有名詞', '数', '接尾', '特殊', '引用文字列'].includes(d),
  動詞: (d) => d === '自立',
  形容詞: (d) => d === '自立',
  副詞: () => true,
  連体詞: () => true,
  接続詞: () => true,
  感動詞: () => true,
}
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

const frequency = new Map<string, number>()
let read = 0
for (let bin = 1; bin < wf.length && read < SURFACES; bin++) {
  for (const surface of wf[bin] as string[]) {
    read++
    if (!JAPANESE.test(surface) || /[0-9０-９]/.test(surface)) continue
    // Only surfaces kuromoji also reads as one morpheme: the fold is then unambiguous enough.
    const tokens = analyzer.tokenize(surface)
    if (tokens.length !== 1 || tokens[0].surface !== surface) continue
    const t = tokens[0]
    if (!VOCABULARY[t.pos]?.(t.posDetail)) continue
    frequency.set(t.lemma, (frequency.get(t.lemma) ?? 0) + 10 ** (-bin / 100))
  }
}

// --- Keep common JMdict vocabulary -----------------------------------------------------------

/** Parts of speech that are grammar, not vocabulary (an entry made only of these is dropped). */
const GRAMMAR = new Set(['prt', 'aux', 'aux-v', 'aux-adj', 'cop', 'suf', 'pref'])
/** Too short or too grammatical to be a card, whatever kuromoji made of them on their own. */
const SKIP = new Set(['ない', 'てる', 'たい', 'じゃ', 'なら', 'かも', 'より', 'ちゃう', 'ちゃ', 'っす', 'ます', 'です'])

const words: [string, string][] = []
const used = new Set<string>()
/** Fronts and readings already in, to skip a kana spelling of a word that's already there. */
const fronts = new Set<string>()
const readings = new Set<string>()
const dropped: Record<string, number> = { notCommon: 0, grammar: 0, vulgar: 0, short: 0, duplicate: 0 }
for (const [lemma] of [...frequency].sort((a, b) => b[1] - a[1])) {
  if (words.length >= COUNT) break
  if (/^[\p{Script=Hiragana}]$/u.test(lemma) || SKIP.has(lemma)) {
    dropped.short++
    continue
  }
  const reading = toHiragana(analyzer.tokenize(lemma).map((t) => t.reading).join(''))
  const candidates = (bySpelling.get(lemma) ?? []).filter((e) => [...e.kanji, ...e.kana].some((s) => s.text === lemma && s.common))
  // The entry whose reading kuromoji gives, else the first common one.
  const entry = candidates.find((e) => e.kana.some((k) => toHiragana(k.text) === reading)) ?? candidates[0]
  if (!entry) {
    dropped.notCommon++
    continue
  }
  if (entry.sense.every((s) => s.partOfSpeech.every((p) => GRAMMAR.has(p)))) {
    dropped.grammar++
    continue
  }
  if (entry.sense.some((s) => s.misc.includes('vulg') || s.misc.includes('X'))) {
    dropped.vulgar++
    continue
  }
  if (used.has(entry.id)) {
    dropped.duplicate++ // another spelling of a word already in (良い after いい)
    continue
  }
  // The entry's spelling of the reading kuromoji gives (else its first common kana).
  const kana = entry.kana.find((k) => k.common) ?? entry.kana[0]
  const entryReading = entry.kana.find((k) => toHiragana(k.text) === reading)?.text ?? kana.text
  // Written as people usually write it: in kana when JMdict says so ("usually kana"), as that
  // same reading, so the front and the reading never disagree (みな, not みな(みんな)).
  const usuallyKana = entry.sense[0]?.misc.includes('uk') && /\p{Script=Han}/u.test(lemma)
  const front = usuallyKana ? entryReading : lemma
  // A kana spelling of a word already in (みる after 見る, くる after 来る: verbs that are mostly
  // auxiliaries in text), or a front already used, adds nothing.
  const kanaOnly = !/\p{Script=Han}/u.test(front)
  if (fronts.has(front) || (kanaOnly && readings.has(toHiragana(entryReading)))) {
    dropped.duplicate++
    continue
  }
  used.add(entry.id)
  fronts.add(front)
  readings.add(toHiragana(entryReading))
  // No reading when it would only repeat the front (クマ, くま).
  words.push([front, toHiragana(front) === toHiragana(entryReading) ? front : entryReading])
}
if (words.length < COUNT) throw new Error(`only ${words.length} words; read further than ${SURFACES} surfaces`)

const outFile = join(root, 'packages/core/src/coreWords.json')
writeFileSync(
  outFile,
  JSON.stringify({
    source: 'wordfreq v3.2 (large_ja), folded to dictionary forms and filtered to common JMdict words',
    license: 'CC BY-SA 4.0',
    words,
  }).replace(/\],\[/g, '],\n[') + '\n',
)

const show = (list: [string, string][]) => list.map(([w, r]) => (w === r ? w : `${w}(${r})`)).join(' ')
console.log(`read ${read} surfaces → ${frequency.size} dictionary forms → ${words.length} words; dropped ${JSON.stringify(dropped)}`)
console.log(`top 100: ${show(words.slice(0, 100))}`)
console.log(`3000–3500, every 10th: ${show(words.slice(3000).filter((_, i) => i % 10 === 0))}`)
console.log(`wrote ${outFile}`)
