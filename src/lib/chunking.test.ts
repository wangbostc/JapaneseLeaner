import { describe, expect, it } from 'vitest'
import { testAnalyzer } from '../test/analyzer'
import { phrases, senseGroups, textOf } from './chunking'

async function chunk(text: string) {
  const a = await testAnalyzer()
  const t = a.tokenize(text)
  return { phrases: phrases(t).map((r) => textOf(t, r)), groups: senseGroups(t).map((r) => textOf(t, r)) }
}

describe('phrases (文節)', () => {
  it('attaches particles, auxiliaries and punctuation to their word', async () => {
    expect((await chunk('私は毎朝六時に起きます。')).phrases).toEqual(['私は', '毎朝', '六時に', '起きます。'])
    expect((await chunk('短い時間ですが、毎日続けています。')).phrases).toEqual(['短い', '時間ですが、', '毎日', '続けています。'])
  })

  it('keeps compounds, prefixes and サ変 verbs together', async () => {
    expect((await chunk('日本語のポッドキャストを聞きます。')).phrases).toEqual(['日本語の', 'ポッドキャストを', '聞きます。'])
    expect((await chunk('来月また行こうと約束しました。')).phrases).toEqual(['来月', 'また', '行こうと', '約束しました。'])
    expect((await chunk('お茶を飲む。')).phrases).toEqual(['お茶を', '飲む。'])
  })

  it('starts a quoted phrase at its opening bracket', async () => {
    expect((await chunk('店員さんが「ごゆっくりどうぞ」と言ってくれました。')).phrases).toEqual([
      '店員さんが',
      '「ごゆっくり',
      'どうぞ」と',
      '言ってくれました。',
    ])
  })
})

describe('senseGroups (意群)', () => {
  it('leaves short sentences whole', async () => {
    expect((await chunk('朝ごはんはパンと卵です。')).groups).toEqual(['朝ごはんはパンと卵です。'])
  })

  it('splits long sentences at commas and clause-linking particles', async () => {
    expect((await chunk('例えば、ずっと読みたかった本を一気に読んだり、部屋を片付けたりします。')).groups).toEqual([
      '例えば、',
      'ずっと読みたかった本を一気に読んだり、',
      '部屋を片付けたりします。',
    ])
    expect((await chunk('窓の外の雨の音を聞きながら料理をするのも、意外と落ち着きます。')).groups).toEqual([
      '窓の外の雨の音を聞きながら',
      '料理をするのも、',
      '意外と落ち着きます。',
    ])
    expect((await chunk('駅から少し遠かったけど、店はとても静かでした。')).groups).toEqual(['駅から少し遠かったけど、', '店はとても静かでした。'])
  })

  it('never ends on an empty group', async () => {
    expect((await chunk('天気に気分を左右されないように、自分なりの過ごし方を見つけておくといいでしょう、')).groups.every(Boolean)).toBe(true)
  })
})
