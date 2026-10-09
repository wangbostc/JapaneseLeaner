import { toHiragana } from './kana'

/**
 * Compact entry as written by scripts/build-jmdict.mjs: [kanji, kana, [[pos, glosses]]], then a 1
 * when the word is usually written in kana.
 */
type RawEntry = [string[], string[], [string[], string[]][]] | [string[], string[], [string[], string[]][], 1]

export interface DictData {
  /** The jmdict-simplified release it was built from (examples.json must match it). */
  release?: string
  version: string
  dictDate: string
  tags: Record<string, string>
  entries: RawEntry[]
}

export interface Sense {
  pos: string[]
  glosses: string[]
}

export interface DictEntry {
  /** Its position in the dictionary, which examples.json shares. */
  index: number
  kanji: string[]
  kana: string[]
  senses: Sense[]
}

export interface Dictionary {
  lookup(word: string, reading?: string): DictEntry[]
  describePos(tag: string): string
  version: string
  release?: string
}

const MAX_RESULTS = 3

/**
 * Very common words written in kana whose usual meaning isn't JMdict's first entry spelled that
 * way: いる is mostly 居る (to be), not 要る (to need), which comes first. Checked against the
 * core words (packages/core/src/jmdict.data.test.ts).
 */
export const USUAL_ENTRY: Record<string, string> = { いる: '居る', そう: '然う', つく: '付く' }

export function createDictionary(data: DictData): Dictionary {
  const index = new Map<string, number[]>()
  const add = (form: string, i: number) => {
    const list = index.get(form)
    if (!list) index.set(form, [i])
    else if (list.at(-1) !== i) list.push(i)
  }
  data.entries.forEach(([kanji, kana], i) => {
    kanji.forEach((k) => add(k, i))
    // Kana are indexed folded to hiragana so カッと and かっと meet.
    kana.forEach((k) => add(toHiragana(k), i))
  })

  const toEntry = (i: number): DictEntry => {
    const [kanji, kana, senses] = data.entries[i]
    return { index: i, kanji, kana, senses: senses.map(([pos, glosses]) => ({ pos, glosses })) }
  }
  /** Written in kana: it has no kanji, or JMdict says it's usually written in kana. */
  const kanaWord = (i: number) => data.entries[i][0].length === 0 || data.entries[i][3] === 1

  return {
    version: data.version,
    release: data.release,
    describePos: (tag) => data.tags[tag] ?? tag,
    /**
     * Entries for a dictionary form, best first. With a reading, entries that
     * are read that way come first (e.g. 今日 read きょう before こんにち); then
     * those spelled exactly so (ホット before ほっと, which kana folding joins). A
     * word looked up in kana prefers entries written in kana: いる is 居る, not 射る.
     */
    lookup(word, reading) {
      const hits = index.get(word) ?? index.get(toHiragana(word)) ?? []
      const want = reading ? toHiragana(reading) : null
      const reads = (i: number) => want !== null && data.entries[i][1].some((k) => toHiragana(k) === want)
      const spelled = (i: number) => data.entries[i][0].includes(word) || data.entries[i][1].includes(word)
      const inKana = !/\p{Script=Han}/u.test(word)
      const kana = (i: number) => inKana && kanaWord(i)
      const usual = (i: number) => data.entries[i][0].includes(USUAL_ENTRY[word])
      const rank = (i: number) => [reads(i), spelled(i), usual(i) || kana(i)].map(Number)
      return [...hits]
        .sort((a, b) => {
          const [ra, rb] = [rank(a), rank(b)]
          return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2] || Number(usual(b)) - Number(usual(a)) || a - b
        })
        .slice(0, MAX_RESULTS)
        .map(toEntry)
    },
  }
}
