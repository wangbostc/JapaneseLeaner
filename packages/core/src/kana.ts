const KATA_START = 0x30a1
const KATA_END = 0x30f6
const KATA_TO_HIRA = 0x60

/** Fold katakana to hiragana; every other character passes through. */
export function toHiragana(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    out += code >= KATA_START && code <= KATA_END ? String.fromCodePoint(code - KATA_TO_HIRA) : ch
  }
  return out
}

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヵヶ]/u
const KANA = /^[ぁ-ゟ゠-ヿー]+$/u

export const isKanji = (ch: string) => KANJI.test(ch)
export const hasKanji = (text: string) => [...text].some(isKanji)
export const isKana = (text: string) => KANA.test(text)

/**
 * Strip everything that isn't a letter, digit or kana so readings from the
 * script and from speech recognition compare on sound alone.
 */
export function normalizeReading(text: string): string {
  return toHiragana(text.normalize('NFKC'))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}ー]/gu, '')
}
