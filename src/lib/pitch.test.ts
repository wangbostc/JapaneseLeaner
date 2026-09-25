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

  it('starts a one-mora 平板 word high', () => {
    expect(hl('き', 0)).toBe('H+H') // 気
    expect(hl('き', 1)).toBe('H+L') // 木
  })

  it('rejects an accent beyond the word', () => {
    expect(pitchPattern('あめ', 3)).toBeNull()
  })
})

describe('accent table', () => {
  const table = createAccentTable({ accents: { '橋|はし': '2', '箸|はし': '1', 'ありがとう|ありがとう': '2', '上手|じょうず': '3' } })
  it('looks up by word and reading, and by reading for kana words', () => {
    expect(table.lookup('橋', 'ハシ')).toEqual([2])
    expect(table.lookup('箸', 'はし')).toEqual([1])
    expect(table.lookup('ありがとう', 'ありがとう')).toEqual([2])
    expect(table.lookup('端', 'はし')).toBeNull()
  })
  it('parses several accepted types', () => {
    expect(parseAType('0,2')).toEqual([0, 2])
    expect(parseAType('*')).toEqual([])
  })
})
