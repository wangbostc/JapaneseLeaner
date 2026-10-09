import { describe, expect, it } from 'vitest'
import { createExamples, formRange, tatoebaUrl, tokensIn, type ExamplesData } from './examples'
import { createDictionary } from './jmdict'

const dict = createDictionary({
  release: 'r1',
  version: 'test',
  dictDate: '2026-01-01',
  tags: {},
  entries: [
    [['食べる'], ['たべる'], [[['v1'], ['to eat']]]],
    [['猫'], ['ねこ'], [[['n'], ['cat']]]],
  ],
})
const data: ExamplesData = { release: 'r1', format: 2, examples: [[['もう食べました。', 'I already ate.', '食べ', 123, 0]], 0] }

describe('example sentences', () => {
  it('gives an entry its examples, by its place in the dictionary', () => {
    const examples = createExamples(data, dict)!
    expect(examples.of(dict.lookup('食べる')[0])).toEqual([{ ja: 'もう食べました。', en: 'I already ate.', form: '食べ', tatoebaId: 123, sense: 0 }])
    expect(examples.of(dict.lookup('猫')[0])).toEqual([])
  })

  it('is unavailable with a dictionary of another release, or none', () => {
    expect(createExamples({ ...data, release: 'r2' }, dict)).toBeNull()
    expect(createExamples(data, null)).toBeNull()
    expect(createExamples(null, dict)).toBeNull()
    expect(createExamples(data, createDictionary({ version: 'test', dictDate: '', tags: {}, entries: [] }))).toBeNull()
  })

  it('finds the word in its sentence, and links the sentence', () => {
    expect(formRange({ ja: 'もう食べました。', form: '食べ' })).toEqual([2, 4])
    expect(formRange({ ja: 'もう食べました。', form: '飲み' })).toBeNull()
    expect(tatoebaUrl(123)).toBe('https://tatoeba.org/sentences/123')
  })

  it('marks the tokens that make up the word in its sentence', () => {
    const surfaces = ['もう', '食べ', 'まし', 'た', '。']
    expect([...tokensIn('もう食べました。', surfaces, [2, 4])]).toEqual([1])
    expect([...tokensIn('もう食べました。', surfaces, [2, 7])]).toEqual([1, 2, 3])
    expect([...tokensIn('もう食べました。', surfaces, null)]).toEqual([])
    // A form that starts inside a token still marks it.
    expect([...tokensIn('食べました', ['食べ', 'ました'], [1, 3])]).toEqual([0, 1])
  })
})
