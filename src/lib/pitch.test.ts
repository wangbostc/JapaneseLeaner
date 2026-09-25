import { describe, expect, it } from 'vitest'
import { createAccentTable, morae, parseAType, pitchPattern } from './pitch'

const hl = (reading: string, aType: number) => {
  const p = pitchPattern(reading, aType)!
  return p.high.map((h) => (h ? 'H' : 'L')).join('') + (p.particleHigh ? '+H' : '+L')
}

describe('morae', () => {
  it('joins small kana and counts っ and ー', () => {
    expect(morae('きょう')).toEqual(['きょ', 'う'])
    expect(morae('がっこう')).toEqual(['が', 'っ', 'こ', 'う'])
    expect(morae('こーひー')).toEqual(['こ', 'ー', 'ひ', 'ー'])
  })
})

describe('pitchPattern', () => {
  it('draws the four Tokyo patterns', () => {
    expect(hl('ともだち', 0)).toBe('LHHH+H') // 平板: 友達が
    expect(hl('あめ', 1)).toBe('HL+L') // 頭高: 雨
    expect(hl('おきる', 2)).toBe('LHL+L') // 中高: 起きる
    expect(hl('はし', 2)).toBe('LH+L') // 尾高: 橋 (the particle drops)
    expect(hl('はし', 0)).toBe('LH+H') // 平板: 端
  })

  it('names patterns and marks the drop', () => {
    expect(pitchPattern('はし', 2)).toMatchObject({ name: 'odaka', dropAfter: 1 })
    expect(pitchPattern('せんせい', 3)).toMatchObject({ name: 'nakadaka', dropAfter: 2 })
    expect(pitchPattern('あめ', 1)).toMatchObject({ name: 'atamadaka', dropAfter: 0 })
    expect(pitchPattern('あめ', 0)).toMatchObject({ name: 'heiban', dropAfter: null })
  })

  it('starts a one-mora 平板 word low, rising on the particle', () => {
    expect(hl('き', 0)).toBe('L+H') // 気が
    expect(hl('き', 1)).toBe('H+L') // 木が
  })

  it('rejects an accent beyond the word', () => {
    expect(pitchPattern('あめ', 3)).toBeNull()
  })
})

describe('accent table', () => {
  const table = createAccentTable({
    accents: {
      '橋|はし': '2',
      '箸|はし': '1',
      'ありがとう|ありがとう': '2',
      'くる|くる': '動詞:1;副詞:2',
      'する|する': '0',
    },
  })
  it('looks up by word and reading, and by reading for kana words', () => {
    expect(table.lookup('橋', 'ハシ')).toEqual([2])
    expect(table.lookup('箸', 'はし')).toEqual([1])
    expect(table.lookup('ありがとう', 'ありがとう')).toEqual([2])
    expect(table.lookup('スル', 'する')).toEqual([0]) // kana word: reading form is fine
  })
  it('never falls back to reading alone for a kanji word', () => {
    expect(table.lookup('端', 'はし')).toBeNull()
    expect(table.lookup('為る', 'する')).toBeNull()
  })
  it('picks the homograph matching the part of speech, else the most common', () => {
    expect(table.lookup('くる', 'くる', '動詞')).toEqual([1])
    expect(table.lookup('くる', 'くる', '副詞')).toEqual([2])
    expect(table.lookup('くる', 'くる')).toEqual([1])
    expect(table.lookup('くる', 'くる', '名詞')).toEqual([1])
  })
  it('parses several accepted types', () => {
    expect(parseAType('0,2')).toEqual([0, 2])
    expect(parseAType('*')).toEqual([])
  })
})

describe('the committed accent table', () => {
  it('gives common words their standard Tokyo accent, looked up the way the word sheet does', async () => {
    const { readFileSync } = await import('node:fs')
    const { testAnalyzer } = await import('../test/analyzer')
    const { readingOf } = await import('./scoring')
    const table = createAccentTable(JSON.parse(readFileSync(new URL('../../public/pitch/accents.json', import.meta.url), 'utf8')))
    const a = await testAnalyzer()
    // [sentence, the word tapped (its surface), expected aType of its dictionary form]
    const cases: [string, string, number][] = [
      ['勉強します。', 'し', 0], // する: 為る 0, not 刷る 1
      ['友達が来ます。', '来', 1], // 来る 1
      ['学校に行きます。', '行き', 0], // 行く 0
      ['ここに置きます。', '置き', 0], // 置く 0
      ['葉が落ちる。', '葉', 0], // 葉 0 vs 歯 1
      ['歯が痛い。', '歯', 1],
      ['橋を渡る。', '橋', 2],
      ['毎朝起きます。', '起き', 2],
      ['それはいいね。', 'いい', 1], // lemma 良い in UniDic, lForm ヨイ
      ['彼を信じる。', '信じる', 3], // UniDic's lemma is 信ずる
    ]
    for (const [sentence, surface, expected] of cases) {
      const token = a.tokenize(sentence).find((t) => t.surface === surface)!
      // The first type is the one the word sheet draws; some words list alternates (信じる 3,0).
      expect({ sentence, shown: table.lookup(token.lemma, readingOf(a, token.lemma), token.pos)?.[0] }).toEqual({ sentence, shown: expected })
    }
  })
})
