import { hasKanji, isKanji, toHiragana } from './kana'
import type { Token } from './tokenizer'

export interface RubySegment {
  text: string
  ruby?: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Split a token into ruby segments so furigana sits only over the kanji:
 * 食べる/たべる → [食(た)][べる], 取り消し/とりけし → [取(と)][り][消(け)][し].
 */
export function rubySegments(token: Pick<Token, 'surface' | 'reading'>): RubySegment[] {
  const { surface, reading } = token
  if (!hasKanji(surface) || toHiragana(surface) === reading) return [{ text: surface }]

  const runs: { text: string; kanji: boolean }[] = []
  for (const ch of surface) {
    const kanji = isKanji(ch)
    const last = runs.at(-1)
    if (last && last.kanji === kanji) last.text += ch
    else runs.push({ text: ch, kanji })
  }

  const pattern = runs.map((r) => (r.kanji ? '(.+?)' : escape(toHiragana(r.text)))).join('')
  const match = new RegExp(`^${pattern}$`, 'u').exec(reading)
  if (!match) return [{ text: surface, ruby: reading }]

  let group = 1
  return runs.map((r) => (r.kanji ? { text: r.text, ruby: match[group++] } : { text: r.text }))
}
