import { isKana, toHiragana } from './kana'

/**
 * Dictionary-form pitch accent (Tokyo standard), from UniDic's aType: the mora after
 * which pitch falls, or 0 for no fall (平板). Accent shifts with particles, compounds
 * and conjugation, so this describes the word on its own, not in a given sentence.
 */

const SMALL = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ'])

/** Splits a kana reading into morae: きょう → きょ·う; small ゃ/ゅ/ょ join the previous kana, っ and ー count. */
export function morae(reading: string): string[] {
  const out: string[] = []
  for (const ch of reading) {
    if (SMALL.has(ch) && out.length) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

export type PatternName = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka'

export interface Pitch {
  morae: string[]
  /** High (true) or low (false) for each mora. */
  high: boolean[]
  /** Pitch of a following particle (e.g. が): high only for 平板. */
  particleHigh: boolean
  /** Index of the mora after which pitch drops, or null for 平板. */
  dropAfter: number | null
  name: PatternName
  aType: number
}

export function pitchPattern(reading: string, aType: number): Pitch | null {
  const m = morae(toHiragana(reading))
  if (!m.length || aType < 0 || aType > m.length) return null
  const high = m.map((_, i) => {
    // The first mora is low unless it carries the accent (気が is low-high, 木が high-low).
    if (aType === 1) return i === 0
    if (i === 0) return false
    return aType === 0 || i < aType
  })
  const name: PatternName = aType === 0 ? 'heiban' : aType === 1 ? 'atamadaka' : aType === m.length ? 'odaka' : 'nakadaka'
  return { morae: m, high, particleHigh: aType === 0, dropAfter: aType === 0 ? null : aType - 1, name, aType }
}

/** UniDic may list several accepted types ("0,2"); the first is the most common. */
export function parseAType(value: string): number[] {
  return value
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0)
}

export interface AccentTable {
  /** `pos` is kuromoji's (IPADIC) part of speech, when known; it picks among homographs (くる: 来る vs the adverb). */
  lookup(word: string, reading: string, pos?: string): number[] | null
}

// IPADIC part of speech -> the UniDic ones it covers (UniDic splits out 代名詞 and 形状詞).
const UNIDIC_POS: Record<string, string[]> = {
  名詞: ['名詞', '代名詞', '形状詞'],
  動詞: ['動詞'],
  形容詞: ['形容詞'],
  副詞: ['副詞'],
  連体詞: ['連体詞'],
  接続詞: ['接続詞'],
  感動詞: ['感動詞'],
}

/**
 * Table values are "2" when every part of speech agrees, else "動詞:1;副詞:2" with the
 * most common reading first. Without a matching part of speech, the most common wins.
 */
function pick(value: string, pos?: string): string {
  if (!value.includes(':')) return value
  const entries = value.split(';').map((e) => e.split(':') as [string, string])
  const wanted = pos ? UNIDIC_POS[pos] : undefined
  return (wanted && entries.find(([p]) => wanted.includes(p))?.[1]) || entries[0][1]
}

export function createAccentTable(data: { accents: Record<string, string> }): AccentTable {
  return {
    lookup(word, reading, pos) {
      const r = toHiragana(reading)
      // A word written in kana may be stored under its hiragana form; a kanji word never
      // falls back to reading alone, which would show some homophone's accent.
      const hit = data.accents[`${word}|${r}`] ?? (isKana(word) ? data.accents[`${r}|${r}`] : undefined)
      return hit ? parseAType(pick(hit, pos)) : null
    },
  }
}

let shared: Promise<AccentTable | null> | null = null

/** The accent table, fetched once on first use; null if it isn't available. */
export function getAccentTable(): Promise<AccentTable | null> {
  shared ??= fetch(`${import.meta.env.BASE_URL}pitch/accents.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data ? createAccentTable(data) : null))
    .catch(() => {
      shared = null
      return null
    })
  return shared
}
