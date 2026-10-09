import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CORE_WORDS } from './coreWords'
import { createExamples, formRange, type ExamplesData } from './examples'
import { createDictionary, USUAL_ENTRY, type DictData } from './jmdict'

// The real dictionary and examples, as built by scripts/build-jmdict.mjs (postinstall). CI builds
// them; a checkout without network skips these.
const dir = join(import.meta.dirname, '../../../public/jmdict')
const built = existsSync(join(dir, 'common.json')) && existsSync(join(dir, 'examples.json'))
const read = <T>(name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as T

describe.runIf(built)('the built dictionary and examples', () => {
  const data = read<DictData>('common.json')
  const dict = createDictionary(data)
  const examples = createExamples(read<ExamplesData>('examples.json'), dict)!
  const isKana = (w: string) => !/\p{Script=Han}/u.test(w)

  it('finds every core word, written in kana as a word usually written in kana', () => {
    // As scripts/build-core-words.ts chose them: a kana word is an entry with no kanji, or one
    // JMdict marks usually written in kana.
    const kanaEntry = (i: number) => data.entries[i][0].length === 0 || data.entries[i][3] === 1
    const wrong = CORE_WORDS.filter(([word, reading]) => {
      const entry = dict.lookup(word, reading)[0]
      if (!entry || ![...entry.kanji, ...entry.kana].includes(word)) return true
      return isKana(word) && !kanaEntry(entry.index) && !entry.kanji.includes(USUAL_ENTRY[word])
    })
    expect(wrong).toEqual([])
    // The ones it used to get wrong.
    const first = (word: string) => dict.lookup(word, word)[0]
    expect(first('いる').kanji).toContain('居る')
    expect(first('つく').kanji).toContain('付く')
    expect(first('そう').kanji).toContain('然う')
    expect(first('こと').kanji).toContain('事')
    expect(first('この').kanji).not.toContain('九')
    expect(first('よう').kanji).not.toContain('酔う')
  })

  it('has examples for nearly every core word, each with its word in the sentence', () => {
    const withExamples = CORE_WORDS.filter(([word, reading]) => examples.of(dict.lookup(word, reading)[0]).length > 0)
    expect(withExamples.length).toBeGreaterThan(3200) // 3,303 for 3.6.2
    for (const [word, reading] of CORE_WORDS.slice(0, 200)) for (const e of examples.of(dict.lookup(word, reading)[0])) expect(formRange(e)).not.toBeNull()
  })

  it('gives いる examples of 居る, not 射る', () => {
    const [first] = examples.of(dict.lookup('いる', 'いる')[0])
    expect(first.ja).toContain(first.form)
    expect(first.en.length).toBeGreaterThan(0)
  })
})
