import { afterEach, describe, expect, it } from 'vitest'
import { neuralChoice, rankVoices, setNeuralSynth, speak } from './speech'

const voice = (name: string, voiceURI = name) => ({ name, voiceURI, lang: 'ja-JP' }) as SpeechSynthesisVoice

afterEach(() => setNeuralSynth(null))

describe('rankVoices', () => {
  it('puts natural and downloadable voices ahead of the small built-in ones', () => {
    const ranked = rankVoices([
      voice('Kyoko'),
      voice('Otoya (Compact)'),
      voice('Google 日本語'),
      voice('Microsoft Nanami Online (Natural) - Japanese (Japan)'),
      voice('Kyoko (Enhanced)', 'com.apple.voice.enhanced.ja-JP.Kyoko'),
      voice('Microsoft Haruka Desktop - Japanese'),
    ]).map((v) => v.name)
    expect(ranked).toEqual([
      'Microsoft Nanami Online (Natural) - Japanese (Japan)',
      'Kyoko (Enhanced)',
      'Google 日本語',
      'Kyoko',
      'Otoya (Compact)',
      'Microsoft Haruka Desktop - Japanese',
    ])
  })
})

describe('neuralChoice', () => {
  it('uses the device voice while natural voices are off', () => {
    expect(neuralChoice(undefined)).toBeNull()
    expect(neuralChoice('neural:ja-JP-KeitaNeural')).toBeNull()
  })

  it('defaults to Nanami once they are on, but keeps an explicit choice', () => {
    setNeuralSynth(async () => new Blob())
    expect(neuralChoice(undefined)).toBe('ja-JP-NanamiNeural')
    expect(neuralChoice('neural:ja-JP-KeitaNeural')).toBe('ja-JP-KeitaNeural')
    expect(neuralChoice('com.apple.voice.enhanced.ja-JP.Kyoko')).toBeNull()
    expect(neuralChoice('neural:en-US-JennyNeural')).toBeNull()
  })
})

describe('speak', () => {
  it('falls back to the device when the server cannot speak (offline, quota used up)', async () => {
    const asked: string[] = []
    setNeuralSynth(async (text, v) => {
      asked.push(`${v}:${text}`)
      throw new Error('rateLimit')
    })
    // No device voice in node: the fallback waits out the sentence, so abort it once we've seen the attempt.
    const stop = new AbortController()
    const done = speak('はい。', 1, undefined, stop.signal)
    await new Promise((r) => setTimeout(r, 10))
    stop.abort()
    await done
    expect(asked).toEqual(['ja-JP-NanamiNeural:はい。'])
  })
})
