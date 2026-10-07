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

const KANJI_DIGITS = '〇一二三四五六七八九'
const SMALL_UNITS: [number, string][] = [
  [1000, '千'],
  [100, '百'],
  [10, '十'],
]
const BIG_UNITS: [bigint, string][] = [
  [10n ** 12n, '兆'],
  [10n ** 8n, '億'],
  [10n ** 4n, '万'],
]

/** 0–9999 in kanji: 一 is dropped before 千, 百 and 十 (千五百, 十二), as it's read. */
function underTenThousand(n: number): string {
  let out = ''
  for (const [value, unit] of SMALL_UNITS) {
    const d = Math.floor(n / value) % 10
    if (d) out += (d === 1 ? '' : KANJI_DIGITS[d]) + unit
  }
  return out + (n % 10 ? KANJI_DIGITS[n % 10] : '')
}

/** A whole number in kanji, the way it's read: 6 → 六, 1500 → 千五百, 30000 → 三万, 0 → 零. */
export function kanjiNumber(n: bigint): string {
  if (n === 0n) return '零'
  let out = ''
  let rest = n
  for (const [value, unit] of BIG_UNITS) {
    if (rest >= value) {
      out += underTenThousand(Number(rest / value)) + unit
      rest %= value
    }
  }
  return out + (rest ? underTenThousand(Number(rest)) : '')
}

/**
 * Digits written as kanji numbers, so they get a reading: speech recognition writes 六時 as
 * 6時, which the dictionary can't read. Handles full-width digits and thousands commas.
 */
export function digitsToKanji(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\d{1,3}(?:,\d{3})+(?!\d)|\d+/g, (m) => {
      const digits = m.replace(/,/g, '')
      return digits.length > 16 ? m : kanjiNumber(BigInt(digits))
    })
}
