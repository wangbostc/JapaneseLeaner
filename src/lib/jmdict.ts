import { toHiragana } from './kana'

/** Compact entry as written by scripts/build-jmdict.mjs: [kanji, kana, [[pos, glosses]]]. */
type RawEntry = [string[], string[], [string[], string[]][]]

export interface DictData {
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
  kanji: string[]
  kana: string[]
  senses: Sense[]
}

export interface Dictionary {
  lookup(word: string, reading?: string): DictEntry[]
  describePos(tag: string): string
  version: string
}

const MAX_RESULTS = 3

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

  const toEntry = ([kanji, kana, senses]: RawEntry): DictEntry => ({
    kanji,
    kana,
    senses: senses.map(([pos, glosses]) => ({ pos, glosses })),
  })

  return {
    version: data.version,
    describePos: (tag) => data.tags[tag] ?? tag,
    /**
     * Entries for a dictionary form, best first. With a reading, entries that
     * are read that way come first (e.g. 今日 read きょう before こんにち).
     */
    lookup(word, reading) {
      const hits = index.get(word) ?? index.get(toHiragana(word)) ?? []
      const want = reading ? toHiragana(reading) : null
      const reads = (i: number) => want !== null && data.entries[i][1].some((k) => toHiragana(k) === want)
      return [...hits]
        .sort((a, b) => Number(reads(b)) - Number(reads(a)) || a - b)
        .slice(0, MAX_RESULTS)
        .map((i) => toEntry(data.entries[i]))
    },
  }
}

let shared: Promise<Dictionary | null> | null = null

/** The app-wide dictionary, fetched once on first use; null if it isn't available. */
export function getDictionary(): Promise<Dictionary | null> {
  shared ??= fetch(`${import.meta.env.BASE_URL}jmdict/common.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: DictData | null) => (data ? createDictionary(data) : null))
    .catch(() => {
      shared = null
      return null
    })
  return shared
}
