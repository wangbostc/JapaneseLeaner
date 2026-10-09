import { CORE_WORDS } from './coreWords'
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
 * Very common words written in kana that neither JMdict's order nor the core words' frequency
 * resolves: いる is mostly 居る (to be), not 要る (to need), which comes first; もの is 物, not 者.
 * Each names the entry by a spelling it has (the kana itself for an entry with no kanji: さん is
 * the honorific, not 酸). Checked in packages/core/src/jmdict.data.test.ts.
 */
export const USUAL_ENTRY: Record<string, string> = { いる: '居る', そう: '然う', つく: '付く', もの: '物', たち: '達', さん: 'さん' }

/**
 * How common a written word is: its rank among the 3,500 core words (by frequency), keyed by
 * spelling and reading. かえる is mostly 帰る (rank 178), not 蛙, though both are spelled かえる.
 */
const CORE_RANK = new Map(CORE_WORDS.map(([word, reading], i) => [`${word}|${toHiragana(reading)}`, i + 1]))

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
  /**
   * How common the entry is, as a core rank (Infinity if it isn't a core word): its best kanji
   * spelling's, or, for a word written in kana, the kana's own (`kanaRank`): よく, a core word in
   * kana, is 良く, not 翼 (also a core word, but written in kanji).
   */
  const frequency = (i: number, kanaRank: number) => {
    const [kanji, kana] = data.entries[i]
    let best = kanaWord(i) ? kanaRank : Infinity
    for (const k of kanji) for (const r of kana) best = Math.min(best, CORE_RANK.get(`${k}|${toHiragana(r)}`) ?? Infinity)
    return best
  }

  return {
    version: data.version,
    release: data.release,
    describePos: (tag) => data.tags[tag] ?? tag,
    /**
     * Entries for a dictionary form, best first. With a reading, entries that
     * are read that way come first (e.g. 今日 read きょう before こんにち); then
     * those spelled exactly so (ホット before ほっと, which kana folding joins);
     * then the more common word (かえる: 帰る, not 蛙). Among the rest, a word
     * looked up in kana prefers entries written in kana: こと is 事, not 琴.
     */
    lookup(word, reading) {
      const hits = index.get(word) ?? index.get(toHiragana(word)) ?? []
      const want = reading ? toHiragana(reading) : null
      const reads = (i: number) => want !== null && data.entries[i][1].some((k) => toHiragana(k) === want)
      const spelled = (i: number) => data.entries[i][0].includes(word) || data.entries[i][1].includes(word)
      const inKana = !/\p{Script=Han}/u.test(word)
      const kana = (i: number) => inKana && kanaWord(i)
      const kanaRank = inKana ? (CORE_RANK.get(`${word}|${toHiragana(word)}`) ?? Infinity) : Infinity
      const usual = (i: number) => {
        const [kanji, kana] = data.entries[i]
        return kanji.includes(USUAL_ENTRY[word]) || (kanji.length === 0 && kana.includes(USUAL_ENTRY[word]))
      }
      // Higher is better in every place: matches the reading, spelled so, the usual entry, more
      // common, written in kana.
      const rank = (i: number) => [Number(reads(i)), Number(spelled(i)), Number(usual(i)), -frequency(i, kanaRank), Number(kana(i))]
      return [...hits]
        .sort((a, b) => {
          const [ra, rb] = [rank(a), rank(b)]
          for (let k = 0; k < ra.length; k++) if (ra[k] !== rb[k]) return rb[k] - ra[k]
          return a - b
        })
        .slice(0, MAX_RESULTS)
        .map(toEntry)
    },
  }
}
