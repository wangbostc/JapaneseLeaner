import type { Token } from './tokenizer'

/**
 * Splits a sentence into 文節 (bunsetsu, the smallest natural phrases) and,
 * for long sentences, groups those into 意群 (sense units) — the places a
 * listener can pause. Rule-based on IPADIC part-of-speech tags; each result is
 * a list of token-index ranges, so the caller can render tokens as it likes.
 */

export type Range = [start: number, end: number] // token indices, end exclusive

const INDEPENDENT = new Set(['名詞', '動詞', '形容詞', '副詞', '連体詞', '接続詞', '感動詞', '接頭詞'])
const DEPENDENT_DETAIL = new Set(['非自立', '接尾'])
const LIGHT_VERBS = new Set(['する', 'できる'])

/** Does token i begin a new 文節? */
const OPENING = new Set(['「', '『', '（', '(', '“', '【'])

function startsPhrase(tokens: Token[], i: number): boolean {
  if (i === 0) return true
  const t = tokens[i]
  const prev = tokens[i - 1]
  // An opening bracket begins the quoted phrase, and what follows it belongs to it.
  if (OPENING.has(t.surface)) return true
  if (OPENING.has(prev.surface)) return false
  if (!INDEPENDENT.has(t.pos) || DEPENDENT_DETAIL.has(t.posDetail)) return false
  // 接頭詞 binds to what follows it: お + 茶.
  if (prev.pos === '接頭詞') return false
  // Runs of nouns form one compound (日本 + 語), except after an adverbial time noun: 毎朝 | 六時に.
  if (t.pos === '名詞' && prev.pos === '名詞' && prev.posDetail !== '非自立' && prev.posDetail !== '副詞可能') return false
  // サ変 nouns take する as part of the phrase: 感動 + し + た.
  if (t.pos === '動詞' && LIGHT_VERBS.has(t.lemma) && prev.posDetail === 'サ変接続') return false
  return true
}

export function phrases(tokens: Token[]): Range[] {
  const out: Range[] = []
  tokens.forEach((_, i) => {
    if (startsPhrase(tokens, i)) out.push([i, i + 1])
    else if (out.length) out[out.length - 1][1] = i + 1
    else out.push([i, i + 1])
  })
  return out
}

// Particles after which a listener naturally pauses: て/で forms, が・けど, から・ので, ば, たら, ながら, し.
const CLAUSE_LINKS = new Set(['て', 'で', 'が', 'けど', 'けれど', 'けれども', 'から', 'ので', 'ば', 'たら', 'ながら', 'し', 'のに'])

function endsClause(tokens: Token[], [start, end]: Range): boolean {
  for (let i = end - 1; i >= start; i--) {
    const t = tokens[i]
    if (t.pos === '記号') {
      if (t.surface === '、' || t.surface === ',') return true
      continue
    }
    return t.pos === '助詞' && t.posDetail === '接続助詞' && CLAUSE_LINKS.has(t.surface)
  }
  return false
}

/** Sentences shorter than this are read as one unit. */
export const LONG_SENTENCE_CHARS = 20

/** Sense units for a long sentence (one unit for a short one), each a range over the tokens. */
export function senseGroups(tokens: Token[]): Range[] {
  const length = tokens.reduce((n, t) => n + t.surface.length, 0)
  if (!tokens.length) return []
  if (length < LONG_SENTENCE_CHARS) return [[0, tokens.length]]
  const groups: Range[] = []
  let start = 0
  for (const range of phrases(tokens)) {
    if (endsClause(tokens, range) && range[1] < tokens.length) {
      groups.push([start, range[1]])
      start = range[1]
    }
  }
  groups.push([start, tokens.length])
  return groups
}

export const textOf = (tokens: Token[], [start, end]: Range) =>
  tokens
    .slice(start, end)
    .map((t) => t.surface)
    .join('')
