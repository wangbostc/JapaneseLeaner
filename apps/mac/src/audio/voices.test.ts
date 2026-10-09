import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings, sanitizeSettings } from '../settings'
import { fakeEngineFetch } from './fakeEngines'
import { fakeAudio } from './audio'
import { engineVoices, withEngineVoice, type EngineVoices } from './voices'

const SPEAKERS = { aivis: [{ name: 'まお', styles: [{ name: 'ノーマル', id: 888753760 }] }], voicevox: [{ name: '青山龍星', styles: [{ name: 'ノーマル', id: 13 }] }] }
const dir = () => join(mkdtempSync(join(tmpdir(), 'kikitori-voices-')), 'voices')

describe('engine voices on this Mac', () => {
  it('lists both engines’ voices, AivisSpeech first, and only those that answer', async () => {
    const both = engineVoices(dir(), { fetch: fakeEngineFetch(SPEAKERS).fetch })
    expect(await both.probe()).toEqual({
      up: ['aivis', 'voicevox'],
      voices: [
        { id: 'aivis:888753760', name: 'まお（ノーマル）', speaker: 'まお' },
        { id: 'voicevox:13', name: '青山龍星（ノーマル）', speaker: '青山龍星' },
      ],
    })
    const one = engineVoices(dir(), { fetch: fakeEngineFetch({ voicevox: SPEAKERS.voicevox }).fetch })
    expect((await one.probe()).up).toEqual(['voicevox'])
  })

  it('makes a sentence once per voice, as a file, then reuses it', async () => {
    const engine = fakeEngineFetch(SPEAKERS)
    const voices = engineVoices(dir(), { fetch: engine.fetch })
    const a = await voices.clip('aivis:888753760', '一。')
    expect(await voices.clip('aivis:888753760', '一。')).toBe(a)
    const b = await voices.clip('voicevox:13', '一。')
    expect(b).not.toBe(a)
    expect(engine.made).toEqual([
      ['888753760', '一。'],
      ['13', '一。'],
    ])
    expect(readFileSync(a, 'utf8')).toBe('RIFF-fake-wav')
  })

  it('rejects when the voice’s engine isn’t running', async () => {
    const voices = engineVoices(dir(), { fetch: fakeEngineFetch({ voicevox: SPEAKERS.voicevox }).fetch })
    await expect(voices.clip('aivis:888753760', '一。')).rejects.toThrow()
  })

  it('prunes the least recently used clips beyond the limit, and half-written ones', async () => {
    const d = dir()
    const voices = engineVoices(d, { fetch: fakeEngineFetch(SPEAKERS).fetch })
    const old = await voices.clip('voicevox:13', '古い。')
    const recent = await voices.clip('voicevox:13', '新しい。')
    utimesSync(old, new Date(2026, 0, 1), new Date(2026, 0, 1))
    writeFileSync(join(d, 'x.wav.1-1.part'), 'RIFF')
    await voices.prune(20) // room for one 13-byte clip
    expect(readdirSync(d)).toEqual([recent.slice(d.length + 1)])
    // A clip used again is the most recent.
    await voices.clip('voicevox:13', '古い。')
    expect(existsSync(old)).toBe(true)
  })
})

describe('speaking in an engine voice', () => {
  const stub = (clip: EngineVoices['clip']): EngineVoices => ({ urls: { aivis: '', voicevox: '' }, probe: async () => ({ voices: [], up: [] }), clip })

  it('plays the sentence’s clip at the learner’s rate', async () => {
    const base = fakeAudio()
    const audio = withEngineVoice(base, stub(async (v, text) => `/clips/${v}/${text}.wav`))
    audio.setVoice('aivis:888753760')
    await audio.speak('一。', 0.7)
    expect(base.played).toEqual([{ path: '/clips/aivis:888753760/一。.wav', start: 0, end: null }])
    expect(base.spoken).toEqual([])
  })

  it('speaks in the Mac’s own voice with no engine voice chosen', async () => {
    const base = fakeAudio()
    let asked = 0
    const audio = withEngineVoice(base, stub(async () => (asked++, '/x.wav')))
    await audio.speak('一。', 1)
    expect([base.spoken, asked]).toEqual([['一。'], 0])
  })

  it('falls back to the Mac’s own voice when the engine fails, and leaves it alone for a while', async () => {
    const base = fakeAudio()
    let now = 0
    let asked = 0
    const audio = withEngineVoice(
      base,
      stub(async () => {
        asked++
        throw new TypeError('fetch failed')
      }),
      () => now,
    )
    audio.setVoice('voicevox:13')
    await audio.speak('一。', 1)
    await audio.speak('二。', 1) // not asked again: no 2 s wait per sentence with the engine closed
    expect([base.spoken, asked]).toEqual([['一。', '二。'], 1])
    now += 30_000
    await audio.speak('三。', 1)
    expect(asked).toBe(2)
  })

  it('says nothing when stopped while the clip is being made', async () => {
    const base = fakeAudio()
    const stop = new AbortController()
    const audio = withEngineVoice(
      base,
      stub(async () => {
        stop.abort()
        return '/x.wav'
      }),
    )
    audio.setVoice('voicevox:13')
    await audio.speak('一。', 1, stop.signal)
    expect([base.played, base.spoken]).toEqual([[], []])
  })

  it('cuts off the last sentence spoken without a signal, even while its clip is being made', async () => {
    const base = fakeAudio()
    let release: () => void = () => {}
    const slow = new Promise<void>((r) => (release = r))
    const audio = withEngineVoice(
      base,
      stub(async (_v, text, signal) => {
        if (text === '一。') await slow
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
        return `/${text}.wav`
      }),
    )
    audio.setVoice('voicevox:13')
    const first = audio.speak('一。', 1) // a card's play button, its clip slow to make
    await audio.speak('二。', 1) // the next card's
    release()
    await first
    expect(base.played.map((p) => p.path)).toEqual(['/二。.wav'])
    expect(base.spoken).toEqual([])
  })

  it('speaks in the voice last set', async () => {
    const base = fakeAudio()
    const audio = withEngineVoice(base, stub(async () => '/x.wav'))
    audio.setVoice('voicevox:13')
    await audio.speak('一。', 1)
    audio.setVoice(undefined)
    await audio.speak('二。', 1)
    expect([base.played.length, base.spoken]).toEqual([1, ['二。']])
  })
})

describe('the saved voice', () => {
  const base = defaultSettings('en')

  it('keeps an engine voice with its character', () => {
    expect(sanitizeSettings({ voiceURI: 'aivis:888753760', voiceSpeaker: 'まお' }, base)).toMatchObject({ voiceURI: 'aivis:888753760', voiceSpeaker: 'まお' })
  })

  it('turns a web backup’s Azure or browser voice into the Mac’s own', () => {
    const current = { ...base, voiceURI: 'voicevox:13' as const, voiceSpeaker: '青山龍星' }
    for (const voiceURI of ['neural:ja-JP-NanamiNeural', 'com.apple.voice.compact.ja-JP.Kyoko', 42]) {
      const s = sanitizeSettings({ voiceURI, voiceSpeaker: 'x' }, current)
      expect([s.voiceURI, s.voiceSpeaker]).toEqual([undefined, undefined])
    }
  })

  // As the app restores a backup: its settings merged over the current ones.
  const restore = (saved: Record<string, unknown>) => {
    const current = { ...base, voiceURI: 'aivis:888753760' as const, voiceSpeaker: 'まお' }
    const s = { ...current, ...sanitizeSettings(saved, current) }
    return [s.voiceURI, s.voiceSpeaker]
  }

  it('restores a backup’s voice in place of the current one, never keeping the old character', () => {
    expect(restore({ voiceURI: 'voicevox:13', voiceSpeaker: '青山龍星' })).toEqual(['voicevox:13', '青山龍星'])
    // A web backup's engine voice has no character: asked of the engine, not kept from before.
    expect(restore({ voiceURI: 'voicevox:13' })).toEqual(['voicevox:13', undefined])
    // Saved with the Mac's own voice (or before engine voices), or a web backup's other voice.
    expect(restore({ rate: 1.2 })).toEqual([undefined, undefined])
    expect(restore({ voiceURI: 'neural:ja-JP-NanamiNeural' })).toEqual([undefined, undefined])
  })
})
