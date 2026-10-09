import { describe, expect, it } from 'vitest'
import { createDictionary } from './jmdict'
import { cardKey, isCardModeSetting, modeOf, recallPrompt } from './review'

const D = 86_400_000
const T0 = new Date(2026, 9, 10, 9).getTime()

describe('card modes', () => {
  it('shows every card in the chosen mode', () => {
    for (const mode of ['read', 'listen', 'recall'] as const) expect(modeOf({ uid: 'a', front: 'x' }, mode, T0)).toBe(mode)
  })

  it('mixes the modes across cards, each card keeping its mode all day', () => {
    const cards = Array.from({ length: 60 }, (_, i) => ({ uid: `core:w${i}`, front: `w${i}` }))
    const today = cards.map((c) => modeOf(c, 'mix', T0))
    expect(new Set(today)).toEqual(new Set(['read', 'listen', 'recall']))
    expect(cards.map((c) => modeOf(c, 'mix', T0 + 8 * 3_600_000))).toEqual(today) // later the same day
    expect(cards.map((c) => modeOf(c, 'mix', T0 + D))).not.toEqual(today) // another day, another mix
  })

  it('knows its settings', () => {
    expect(['read', 'listen', 'recall', 'mix'].every(isCardModeSetting)).toBe(true)
    expect(isCardModeSetting('reverse')).toBe(false)
  })
})

describe('recall prompts', () => {
  const dict = createDictionary({ version: 't', dictDate: '', tags: {}, entries: [[['天気'], ['てんき'], [[['n'], ['weather', 'the elements']], [['n'], ['fair weather']]]]] })

  it('asks for a word by its meanings', () => {
    expect(recallPrompt({ kind: 'word', front: '天気', reading: 'てんき' }, dict)).toEqual(['weather; the elements', 'fair weather'])
  })

  it('asks for a word by the meaning it came with, when it has one (a private lesson’s word list)', () => {
    expect(recallPrompt({ kind: 'word', front: '天気', reading: 'てんき', gloss: 'the weather' }, dict)).toEqual(['the weather'])
  })

  it('asks for a sentence by its translation', () => {
    expect(recallPrompt({ kind: 'sentence', front: '雨です。', reading: '' }, dict, 'It is raining.')).toEqual(['It is raining.'])
  })

  it('has nothing to ask with when there is no meaning or translation', () => {
    expect(recallPrompt({ kind: 'word', front: '未知', reading: 'みち' }, dict)).toBeNull()
    expect(recallPrompt({ kind: 'word', front: '天気', reading: 'てんき' }, null)).toBeNull()
    expect(recallPrompt({ kind: 'sentence', front: '雨です。', reading: '' }, dict)).toBeNull()
  })
})

describe('review keys', () => {
  it('shows the answer with Space or Enter, in either app’s key names', () => {
    for (const k of [' ', 'Enter', 'space', 'enter']) expect(cardKey(k, false)).toBe('flip')
    expect(cardKey(' ', true)).toBeNull()
  })

  it('grades with 1–4 only once the answer shows', () => {
    expect(cardKey('3', false)).toBeNull()
    expect([1, 2, 3, 4].map((n) => cardKey(String(n), true))).toEqual([1, 2, 3, 4])
    expect(cardKey('5', true)).toBeNull()
  })

  it('plays with R and undoes with U, either side', () => {
    expect([cardKey('r', false), cardKey('R', true), cardKey('u', false), cardKey('U', true)]).toEqual(['play', 'play', 'undo', 'undo'])
    expect(cardKey('x', true)).toBeNull()
  })
})
