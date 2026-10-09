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
    [['お守り', '御守り', '御守', 'お守'], ['おまもり'], [[['n'], ['charm']]]],
    [['射る'], ['いる'], [[['v1'], ['to shoot']]]],
    [['居る'], ['いる'], [[['v1'], ['to be']]], 1],
    [['琴'], ['こと'], [[['n'], ['koto']]]],
    [['事'], ['こと'], [[['n'], ['thing']]], 1],
  ],
}

describe('dictionary', () => {
  const dict = createDictionary(data)

  it('finds a word by its dictionary form', () => {
    expect(dict.lookup('起きる')).toEqual([{ index: 2, kanji: ['起きる'], kana: ['おきる'], senses: [{ pos: ['v1'], glosses: ['to get up', 'to rise'] }] }])
    expect(dict.describePos('v1')).toBe('Ichidan verb')
    expect(dict.describePos('zzz')).toBe('zzz')
  })

  it('ranks the entry matching the reading first', () => {
    expect(dict.lookup('今日', 'きょう').map((e) => e.kana[0])).toEqual(['きょう', 'こんにち'])
    expect(dict.lookup('今日', 'こんにち').map((e) => e.kana[0])).toEqual(['こんにち', 'きょう'])
    // With no reading, the more common word (今日 read きょう is a core word).
    expect(dict.lookup('今日').map((e) => e.kana[0])).toEqual(['きょう', 'こんにち'])
  })

  it('matches kana regardless of hiragana/katakana', () => {
    expect(dict.lookup('かっと')[0].senses[0].glosses).toEqual(['flaring up'])
    expect(dict.lookup('カッと')[0].senses[0].glosses).toEqual(['flaring up'])
  })

  it('finds a word by any of its written forms, not just the first few', () => {
    expect(dict.lookup('お守')[0].senses[0].glosses).toEqual(['charm'])
  })

  it('finds a word written in kana as the entry usually written that way, not an earlier kanji-only one', () => {
    expect(dict.lookup('いる').map((e) => e.kanji[0])).toEqual(['居る', '射る'])
    expect(dict.lookup('いる', 'いる')[0].senses[0].glosses).toEqual(['to be'])
    expect(dict.lookup('こと')[0].kanji).toEqual(['事'])
    // Kana folding joins ホット and ほっと: the spelling decides.
    expect(createDictionary({ ...data, entries: [[[], ['ほっと'], [[['adv'], ['relieved']]]], [[], ['ホット'], [[['adj-na'], ['hot']]]]] }).lookup('ホット')[0].senses[0].glosses).toEqual(['hot'])
    // Written in kanji, the kanji decides.
    expect(dict.lookup('射る')[0].senses[0].glosses).toEqual(['to shoot'])
  })

  it('returns nothing for unknown words', () => {
    expect(dict.lookup('ぬぬぬ')).toEqual([])
  })
})
