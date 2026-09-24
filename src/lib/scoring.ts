import { normalizeReading } from './kana'
import type { Analyzer, Token } from './tokenizer'

/** Hiragana reading of a whole utterance, punctuation and spaces removed. */
export const readingOf = (analyzer: Analyzer, text: string) =>
  normalizeReading(analyzer.tokenize(text).map((t) => t.reading).join(''))

export interface CharMark {
  char: string
  hit: boolean
}

export interface ShadowingResult {
  /** 0..100, based on kana-level edit distance. */
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  /** Each kana of the target reading, marked hit if the learner said it. */
  marks: CharMark[]
}

/** Levenshtein over code points, plus which target chars were matched. */
function align(target: string[], spoken: string[]): { distance: number; hits: boolean[] } {
  const n = target.length
  const m = spoken.length
  const d = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = target[i - 1] === spoken[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub)
    }
  }
  const hits = new Array<boolean>(n).fill(false)
  let i = n
  let j = m
  // Among equally cheap alignments, skip trailing target kana first so the
  // matches land as early as possible: a truncated attempt lines up with the
  // start of the sentence, not with later repeats of the same kana.
  while (i > 0 && j > 0) {
    if (d[i][j] === d[i - 1][j] + 1) {
      i--
    } else if (target[i - 1] === spoken[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      hits[--i] = true
      j--
    } else if (d[i][j] === d[i][j - 1] + 1) {
      j--
    } else {
      i--
      j--
    }
  }
  return { distance: d[n][m], hits }
}

export function gradeFor(score: number): ShadowingResult['grade'] {
  if (score >= 90) return 'S'
  if (score >= 75) return 'A'
  if (score >= 55) return 'B'
  return 'C'
}

/**
 * Score a shadowing attempt by sound: both the script and the recognised
 * speech are reduced to hiragana, since recognisers pick kanji freely
 * (今日/きょう, 私/わたし) and a surface comparison would punish that.
 */
export function scoreShadowing(targetReading: string, spokenReading: string): ShadowingResult {
  const target = [...normalizeReading(targetReading)]
  const spoken = [...normalizeReading(spokenReading)]
  if (target.length === 0) return { score: 0, grade: 'C', marks: [] }
  const { distance, hits } = align(target, spoken)
  const score = Math.max(0, Math.round((1 - distance / target.length) * 100))
  return { score, grade: gradeFor(score), marks: target.map((char, k) => ({ char, hit: hits[k] })) }
}

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞'])
const SKIP_DETAIL = new Set(['非自立', '代名詞', '数', '接尾'])
// Light verbs carry grammar, not content (感動する → 感動 is the word).
const SKIP_LEMMAS = new Set(['する', 'ある', 'いる', 'なる', 'できる'])

/** Content-word lemmas: nouns, verbs, adjectives, adverbs; not particles or auxiliaries. */
export function contentLemmas(tokens: Token[]): Set<string> {
  const out = new Set<string>()
  for (const t of tokens) {
    if (CONTENT_POS.has(t.pos) && !SKIP_DETAIL.has(t.posDetail) && !SKIP_LEMMAS.has(t.lemma)) out.add(t.lemma)
  }
  return out
}

export interface RetellResult {
  coverage: number
  used: string[]
  missed: string[]
}

/**
 * The kana a retelling must contain to count a word as reused. Inflecting
 * words drop their last kana (会う → あ) and need at least two left, so short
 * stems don't match by accident.
 */
function kanaKey(analyzer: Analyzer, t: Token): string | null {
  const reading = readingOf(analyzer, t.lemma)
  if (t.pos === '動詞' || t.pos === '形容詞') {
    const stem = reading.slice(0, -1)
    return stem.length >= 2 ? stem : null
  }
  return reading.length >= 2 ? reading : null
}

/** How many of the passage's content words the retelling reused. */
export function scoreRetell(analyzer: Analyzer, passage: string, retelling: string): RetellResult {
  const targetTokens = new Map<string, Token>()
  for (const t of analyzer.tokenize(passage)) {
    if (contentLemmas([t]).size && !targetTokens.has(t.lemma)) targetTokens.set(t.lemma, t)
  }
  const said = contentLemmas(analyzer.tokenize(retelling))
  // Recognisers often write in kana what the script wrote in kanji, and the
  // tokenizer splits long kana runs badly, so also match on the reading.
  const saidReading = readingOf(analyzer, retelling)
  const used: string[] = []
  const missed: string[] = []
  for (const [lemma, token] of targetTokens) {
    const key = kanaKey(analyzer, token)
    if (said.has(lemma) || (key !== null && saidReading.includes(key))) used.push(lemma)
    else missed.push(lemma)
  }
  return { coverage: targetTokens.size ? Math.round((used.length / targetTokens.size) * 100) : 0, used, missed }
}
