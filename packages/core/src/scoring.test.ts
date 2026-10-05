import { describe, expect, it } from 'vitest'
import { testAnalyzer } from '../test/analyzer'
import { contentLemmas, readingOf, scoreRetell, scoreShadowing } from './scoring'

describe('scoreShadowing', () => {
  it('scores a perfect attempt 100 even when the recogniser picks different kanji', async () => {
    const a = await testAnalyzer()
    const target = readingOf(a, '今日は天気がいいですね。')
    const spoken = readingOf(a, 'きょうは天気がいいですね')
    expect(target).toBe('きょうはてんきがいいですね')
    const r = scoreShadowing(target, spoken)
    expect(r.score).toBe(100)
    expect(r.grade).toBe('S')
    expect(r.marks.every((m) => m.hit)).toBe(true)
  })

  it('marks the missed kana and scores by edit distance', () => {
    // Dropped "ね" and "す": 2 edits over 13 kana.
    const r = scoreShadowing('きょうはてんきがいいですね', 'きょうはてんきがいいで')
    expect(r.score).toBe(85)
    expect(r.grade).toBe('A')
    expect(r.marks.filter((m) => !m.hit).map((m) => m.char)).toEqual(['す', 'ね'])
  })

  it('lines a truncated attempt up with the start of the sentence', () => {
    const r = scoreShadowing('あさごはんはぱんとたまごです', 'あさごはん')
    expect(r.marks.map((m) => (m.hit ? m.char : '_')).join('')).toBe('あさごはん_________')
    expect(r.score).toBe(36)
  })

  it('folds katakana and ignores punctuation', () => {
    expect(scoreShadowing('コーヒー、ください。', 'こーひーください').score).toBe(100)
  })

  it('returns 0 for silence and for an empty target', () => {
    expect(scoreShadowing('ありがとう', '').score).toBe(0)
    expect(scoreShadowing('', 'ありがとう')).toEqual({ score: 0, grade: 'C', marks: [] })
  })
})

describe('retell', () => {
  it('keeps content words and drops particles and auxiliaries', async () => {
    const a = await testAnalyzer()
    expect([...contentLemmas(a.tokenize('私は駅で友達に会いました。'))]).toEqual(['駅', '友達', '会う'])
  })

  it('credits words said in kana that the passage wrote in kanji', async () => {
    const a = await testAnalyzer()
    const r = scoreRetell(a, '私は駅で友達に会いました。', 'えきでともだちとあった')
    expect(r.used).toEqual(['駅', '友達'])
    // 会う's stem is one kana (あ): too short to match safely, so it isn't credited.
    expect(r.missed).toEqual(['会う'])
    expect(r.coverage).toBe(67)
  })

  it('credits inflected verbs by lemma', async () => {
    const a = await testAnalyzer()
    const r = scoreRetell(a, '私は駅で友達に会いました。', '駅で友達と会った')
    expect(r.used).toEqual(['駅', '友達', '会う'])
    expect(r.coverage).toBe(100)
  })

  it('skips light verbs and credits suru-nouns said in kana', async () => {
    const a = await testAnalyzer()
    const r = scoreRetell(a, '映画を見て、感動した。', 'えいがをみてかんどうした')
    expect(r.used).toEqual(['映画', '感動'])
    expect(r.missed).toEqual(['見る'])
  })

  it('credits a kana verb whose stem is two kana or more', async () => {
    const a = await testAnalyzer()
    expect(scoreRetell(a, '友達と話しました。', 'ともだちとはなした').used).toEqual(['友達', '話す'])
  })

  it('reports what was missed', async () => {
    const a = await testAnalyzer()
    const r = scoreRetell(a, '私は駅で友達に会いました。', '駅に行きました')
    expect(r.used).toEqual(['駅'])
    expect(r.missed).toEqual(['友達', '会う'])
    expect(r.coverage).toBe(33)
  })
})
