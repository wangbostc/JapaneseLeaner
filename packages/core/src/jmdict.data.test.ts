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
  })

  it('finds the everyday word for words written in kana, not a rarer one spelled the same', () => {
    // Checked by hand, not by the lookup's own rules: what a learner reading these means.
    const everyday: [string, string][] = [
      ['いる', '居る'], ['こと', '事'], ['この', '此の'], ['よう', '様'], ['よく', '良く'], ['また', '又'], ['もの', '物'],
      ['たち', '達'], ['みる', '見る'], ['いく', '行く'], ['いう', '言う'], ['かう', '買う'], ['かえる', '帰る'],
      ['ひく', '引く'], ['かく', '書く'], ['おす', '押す'], ['はし', '橋'], ['くも', '雲'], ['やすい', '安い'],
      ['あい', '愛'], ['できる', '出来る'], ['わかる', '分かる'], ['つく', '付く'], ['とる', '取る'], ['まつ', '待つ'],
      ['わけ', '訳'], ['かわ', '川'], ['たま', '玉'], ['こおり', '氷'], ['ならう', '習う'], ['あと', '後'], ['きのう', '昨日'],
      ['なん', '何'], ['ただす', '正す'], ['かね', '金'],
    ]
    expect(everyday.filter(([word, kanji]) => !dict.lookup(word, word)[0].kanji.includes(kanji))).toEqual([])
    expect(dict.lookup('さん', 'さん')[0].kanji).toEqual([]) // the honorific, not 酸
    expect(dict.lookup('かしら', 'かしら')[0].kanji).toEqual([]) // "I wonder", not 頭 (read あたま)
    // An entry listing a spelling as a minor variant doesn't win by its main form's frequency.
    expect(dict.lookup('家', 'うち')[0].kanji[0]).toBe('家')
    expect(dict.lookup('着く')[0].kanji[0]).toBe('着く')
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
