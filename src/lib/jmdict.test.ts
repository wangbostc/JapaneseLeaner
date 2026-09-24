import { describe, expect, it } from 'vitest'
import { createDictionary, type DictData } from './jmdict'

const data: DictData = {
  version: 'test',
  dictDate: '2026-01-01',
  tags: { n: 'noun (common) (futsuumeishi)', v1: 'Ichidan verb' },
  entries: [
    [['今日'], ['こんにち'], [[['n'], ['today', 'these days']]]],
    [['今日'], ['きょう', 'けふ'], [[['n'], ['today', 'this day']]]],
    [['起きる'], ['おきる'], [[['v1'], ['to get up', 'to rise']]]],
    [[], ['カッと', 'かっと'], [[['adv'], ['flaring up']]]],
  ],
}

describe('dictionary', () => {
  const dict = createDictionary(data)

  it('finds a word by its dictionary form', () => {
    expect(dict.lookup('起きる')).toEqual([{ kanji: ['起きる'], kana: ['おきる'], senses: [{ pos: ['v1'], glosses: ['to get up', 'to rise'] }] }])
    expect(dict.describePos('v1')).toBe('Ichidan verb')
    expect(dict.describePos('zzz')).toBe('zzz')
  })

  it('ranks the entry matching the reading first', () => {
    expect(dict.lookup('今日', 'きょう').map((e) => e.kana[0])).toEqual(['きょう', 'こんにち'])
    expect(dict.lookup('今日', 'こんにち').map((e) => e.kana[0])).toEqual(['こんにち', 'きょう'])
    expect(dict.lookup('今日').map((e) => e.kana[0])).toEqual(['こんにち', 'きょう'])
  })

  it('matches kana regardless of hiragana/katakana', () => {
    expect(dict.lookup('かっと')[0].senses[0].glosses).toEqual(['flaring up'])
    expect(dict.lookup('カッと')[0].senses[0].glosses).toEqual(['flaring up'])
  })

  it('returns nothing for unknown words', () => {
    expect(dict.lookup('ぬぬぬ')).toEqual([])
  })
})
