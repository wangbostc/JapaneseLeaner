import { describe, expect, it } from 'vitest'
import { testAnalyzer } from '../test/analyzer'
import { rubySegments } from './furigana'

describe('tokenizer', () => {
  it('reads, lemmatizes and tags a sentence', async () => {
    const a = await testAnalyzer()
    const tokens = a.tokenize('私は毎朝コーヒーを飲みました。')
    expect(tokens.map((t) => t.surface)).toEqual(['私', 'は', '毎朝', 'コーヒー', 'を', '飲み', 'まし', 'た', '。'])
    expect(tokens.map((t) => t.reading).join('')).toBe('わたしはまいあさこーひーをのみました。')
    expect(tokens[5].lemma).toBe('飲む')
    expect(tokens[1].pos).toBe('助詞')
  })
})

describe('rubySegments', () => {
  it('puts furigana over the kanji only', () => {
    expect(rubySegments({ surface: '食べる', reading: 'たべる' })).toEqual([{ text: '食', ruby: 'た' }, { text: 'べる' }])
    expect(rubySegments({ surface: 'お茶', reading: 'おちゃ' })).toEqual([{ text: 'お' }, { text: '茶', ruby: 'ちゃ' }])
    expect(rubySegments({ surface: '取り消し', reading: 'とりけし' })).toEqual([
      { text: '取', ruby: 'と' },
      { text: 'り' },
      { text: '消', ruby: 'け' },
      { text: 'し' },
    ])
  })

  it('leaves kana and katakana alone', () => {
    expect(rubySegments({ surface: 'コーヒー', reading: 'こーひー' })).toEqual([{ text: 'コーヒー' }])
    expect(rubySegments({ surface: 'を', reading: 'を' })).toEqual([{ text: 'を' }])
  })

  it('falls back to whole-token ruby when the reading does not line up', () => {
    expect(rubySegments({ surface: '今日', reading: 'きょう' })).toEqual([{ text: '今日', ruby: 'きょう' }])
  })
})
