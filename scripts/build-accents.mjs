// Builds public/pitch/accents.json: dictionary-form pitch accent (UniDic aType) for
// JMdict's common words. Run by hand when updating; the output is committed, because
// the source lexicon is a 555 MB download.
//
//   curl -O https://clrd.ninjal.ac.jp/unidic_archive/cwj/3.1.0/unidic-cwj-3.1.0.zip
//   unzip unidic-cwj-3.1.0.zip 'unidic-cwj-3.1.0/lex_3_1.csv'
//   node scripts/build-accents.mjs unidic-cwj-3.1.0/lex_3_1.csv
//
// UniDic © The UniDic Consortium, used under the BSD licence (public/pitch/UNIDIC-LICENSE.txt).
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const lexPath = process.argv[2]
if (!lexPath) throw new Error('usage: node scripts/build-accents.mjs path/to/lex_3_1.csv')
const root = join(import.meta.dirname, '..')

// CSV columns: surface, left id, right id, cost, then UniDic features f[0..28].
const F = (k) => 4 + k
const COST = 3
const COL = { pos1: F(0), pos2: F(1), cForm: F(5), lForm: F(6), orthBase: F(10), kanaBase: F(21), aType: F(24) }

/** Splits one CSV line, honouring double-quoted fields ("0,2"). */
function splitCsv(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

// The words we can show: every written form of JMdict's common entries, with their readings.
const jmdict = JSON.parse(readFileSync(join(root, 'public/jmdict/common.json'), 'utf8'))
const wanted = new Set()
for (const [kanji, kana] of jmdict.entries) {
  const readings = kana.map(toHiragana)
  for (const r of readings) {
    wanted.add(`${r}|${r}`)
    for (const k of kanji) wanted.add(`${k}|${r}`)
  }
  // Katakana words are written in katakana; key them by their own form too.
  for (const k of kana) for (const r of readings) wanted.add(`${k}|${r}`)
}

// key -> part of speech -> the most common (lowest-cost) row's aType. Kana spellings are shared
// by several words (する: 為る 0, 刷る 1), so keeping the first row seen is wrong; cost is UniDic's
// own measure of how usual a reading is, and part of speech lets the app match the word it has.
const best = new Map()
const rl = createInterface({ input: createReadStream(lexPath) })
for await (const line of rl) {
  const f = splitCsv(line)
  const aType = f[COL.aType]
  if (!aType || aType === '*') continue
  // Dictionary forms only: uninflected words, or the plain terminal form of inflecting ones.
  const cForm = f[COL.cForm]
  if (cForm !== '*' && cForm !== '終止形-一般') continue
  if (f[COL.pos1] === '補助記号' || f[COL.pos1] === '記号') continue
  // Proper nouns share spellings with common words (橋 the surname is 1, 橋 the bridge is 2).
  if (f[COL.pos2] === '固有名詞') continue
  // Sound-changed variants (貸す read がす after rendaku) aren't the word's own reading.
  if (f[COL.kanaBase] !== f[COL.lForm]) continue
  const key = `${f[COL.orthBase]}|${toHiragana(f[COL.kanaBase])}`
  if (!wanted.has(key)) continue
  const pos = f[COL.pos1]
  const cost = Number(f[COST])
  let byPos = best.get(key)
  if (!byPos) best.set(key, (byPos = new Map()))
  const cur = byPos.get(pos)
  if (!cur || cost < cur.cost) byPos.set(pos, { cost, aType })
}

// "2" when every part of speech agrees (most words); otherwise "動詞:1;副詞:2", most common first.
const accents = {}
for (const key of [...best.keys()].sort()) {
  const rows = [...best.get(key)].sort((a, b) => a[1].cost - b[1].cost)
  const types = new Set(rows.map(([, r]) => r.aType))
  accents[key] = types.size === 1 ? rows[0][1].aType : rows.map(([pos, r]) => `${pos}:${r.aType}`).join(';')
}
writeFileSync(join(root, 'public/pitch/accents.json'), JSON.stringify({ source: 'UniDic cwj 3.1.0 (aType)', accents }))
console.log(`wrote ${Object.keys(accents).length} accents`)
