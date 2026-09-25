import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { neuralChoice, rankVoices, setNeuralSynth, speak } from './speech'

const voice = (name: string, voiceURI = name, localService = true) => ({ name, voiceURI, lang: 'ja-JP', localService }) as SpeechSynthesisVoice

/** A device voice that records what it says and finishes at once. */
function fakeDeviceVoice() {
  const said: string[] = []
  const synth = {
    getVoices: () => [voice('Kyoko')],
    addEventListener: () => {},
    cancel: () => {},
    speak: (u: { text: string; onend?: () => void }) => {
      said.push(u.text)
      setTimeout(() => u.onend?.(), 0)
    },
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('window', { speechSynthesis: synth })
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      onend?: () => void
      text: string
      constructor(text: string) {
        this.text = text
      }
    },
  )
  return said
}

/**
 * An Audio element whose play() the browser refuses (autoplay rules), or allows and finishes.
 * speech.ts keeps one element for good, so the behaviour is read at call time, not construction.
 */
const audio = { refuse: false, played: [] as string[] }
class FakeAudio {
  src = ''
  onended: (() => void) | null = null
  pause() {}
  play() {
    audio.played.push(this.src)
    if (audio.refuse) return Promise.reject(new DOMException('needs a tap', 'NotAllowedError'))
    setTimeout(() => this.onended?.(), 0)
    return Promise.resolve()
  }
}
function fakeAudio(refuse: boolean) {
  audio.refuse = refuse
  audio.played = []
  vi.stubGlobal('Audio', FakeAudio)
  return audio.played
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => {
  setNeuralSynth(null)
  vi.unstubAllGlobals()
})

describe('rankVoices', () => {
  it('puts natural and downloadable voices ahead of the small built-in and novelty ones', () => {
    const ranked = rankVoices(
      [
        voice('Eddy (日本語（日本）)'),
        voice('Kyoko'),
        voice('Otoya (Compact)'),
        voice('Google 日本語', 'Google 日本語', false),
        voice('Microsoft Nanami Online (Natural) - Japanese (Japan)', 'nanami', false),
        voice('Kyoko (Enhanced)', 'com.apple.voice.enhanced.ja-JP.Kyoko'),
        voice('Grandma (日本語（日本）)'),
        voice('Microsoft Haruka Desktop - Japanese'),
      ],
      true,
    ).map((v) => v.name)
    expect(ranked).toEqual([
      'Microsoft Nanami Online (Natural) - Japanese (Japan)',
      'Kyoko (Enhanced)',
      'Google 日本語',
      'Kyoko',
      'Otoya (Compact)',
      'Microsoft Haruka Desktop - Japanese',
      'Eddy (日本語（日本）)',
      'Grandma (日本語（日本）)',
    ])
  })

  it('offline, puts every voice on the device ahead of network voices, which would say nothing', () => {
    const ranked = rankVoices([voice('Google 日本語', 'g', false), voice('Eddy (日本語（日本）)'), voice('Kyoko')], false).map((v) => v.name)
    expect(ranked).toEqual(['Kyoko', 'Eddy (日本語（日本）)', 'Google 日本語'])
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

  it('takes VOICEVOX voices, and the default the app gives when Azure is off', () => {
    setNeuralSynth(async () => new Blob(), 'voicevox:30')
    expect(neuralChoice(undefined)).toBe('voicevox:30')
    expect(neuralChoice('voicevox:3')).toBe('voicevox:3')
    expect(neuralChoice('voicevox:x')).toBeNull()
  })
})

describe('speak', () => {
  it('plays the natural voice when the server has it, and the device stays quiet', async () => {
    const said = fakeDeviceVoice()
    const played = fakeAudio(false)
    setNeuralSynth(async () => new Blob(['mp3'], { type: 'audio/mpeg' }))
    await speak('はい。')
    expect(played).toHaveLength(1)
    expect(played[0]).toMatch(/^blob:/)
    expect(said).toEqual([])
  })

  it('has the device say it when the server cannot (offline, quota used up)', async () => {
    const said = fakeDeviceVoice()
    const played = fakeAudio(false)
    const asked: string[] = []
    setNeuralSynth(async (text, v) => {
      asked.push(`${v}:${text}`)
      throw new Error('rateLimit')
    })
    await speak('はい。')
    expect(asked).toEqual(['ja-JP-NanamiNeural:はい。'])
    expect(played).toEqual([])
    expect(said).toEqual(['はい。'])
  })

  it('has the device say it when the browser refuses to play the clip', async () => {
    const said = fakeDeviceVoice()
    const played = fakeAudio(true)
    setNeuralSynth(async () => new Blob(['mp3'], { type: 'audio/mpeg' }))
    await speak('いいえ。')
    expect(played).toHaveLength(1)
    expect(said).toEqual(['いいえ。'])
  })

  it('says nothing more once stopped, even if the server fails afterwards', async () => {
    const said = fakeDeviceVoice()
    const stop = new AbortController()
    setNeuralSynth(async (_t, _v, signal) => {
      await new Promise((r) => setTimeout(r, 5))
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Blob()
    })
    const done = speak('まだ。', 1, undefined, stop.signal)
    stop.abort()
    await done
    expect(said).toEqual([])
  })
})
