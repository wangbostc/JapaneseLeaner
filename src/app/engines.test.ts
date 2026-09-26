import { afterEach, describe, expect, it, vi } from 'vitest'
import { engineUrls, probeEngine, probeEngines, setEnginesOn, synthesize } from './engines'

afterEach(() => vi.unstubAllGlobals())

const speakers = {
  'http://127.0.0.1:50021': [
    { name: '青山龍星', styles: [{ name: 'ノーマル', id: 13, type: 'talk' }] },
    { name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }, { name: 'ハミング', id: 3001, type: 'humming' }] },
  ],
  'http://127.0.0.1:10101': [{ name: 'まお', styles: [{ name: 'ノーマル', id: 888753760, type: 'talk' }, { name: 'おちつき', id: 888753763, type: 'talk' }] }],
}

describe('speech engines on this computer', () => {
  it('lists each talking style as a voice of its engine, named for the character and style', async () => {
    vi.stubGlobal('fetch', async (url: string) => Response.json(speakers[url.replace('/speakers', '') as keyof typeof speakers]))
    expect(await probeEngine('voicevox', 'http://127.0.0.1:50021')).toEqual([
      { id: 'voicevox:13', name: '青山龍星（ノーマル）', speaker: '青山龍星' },
      { id: 'voicevox:3', name: 'ずんだもん（ノーマル）', speaker: 'ずんだもん' },
    ])
    expect(await probeEngine('aivis', 'http://127.0.0.1:10101')).toEqual([
      { id: 'aivis:888753760', name: 'まお（ノーマル）', speaker: 'まお' },
      { id: 'aivis:888753763', name: 'まお（おちつき）', speaker: 'まお' },
    ])
  })

  it('asks both engines, AivisSpeech first, and reports which answered', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('http://127.0.0.1:50021')) throw new TypeError('Failed to fetch')
      return Response.json(speakers['http://127.0.0.1:10101'])
    })
    const found = await probeEngines({ voicevox: 'http://127.0.0.1:50021', aivis: 'http://127.0.0.1:10101' })
    expect(found.up).toEqual(['aivis'])
    expect(found.voices.map((v) => v.id)).toEqual(['aivis:888753760', 'aivis:888753763'])
  })

  it('is absent when nothing answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await probeEngine('voicevox', 'http://127.0.0.1:50021')).toBeNull()
  })

  it('synthesises the engine’s own query, at 24 kHz (AivisSpeech defaults to 44.1)', async () => {
    const calls: { url: string; body?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined })
      return url.includes('audio_query') ? Response.json({ speedScale: 1, outputSamplingRate: 44100 }) : new Response(new Blob(['RIFF'], { type: 'audio/wav' }))
    })
    const blob = await synthesize('http://127.0.0.1:10101', 'aivis:888753760', '一。')
    expect(blob.type).toBe('audio/wav')
    expect(calls.map((c) => c.url)).toEqual([
      `http://127.0.0.1:10101/audio_query?speaker=888753760&text=${encodeURIComponent('一。')}`,
      'http://127.0.0.1:10101/synthesis?speaker=888753760',
    ])
    expect(JSON.parse(calls[1].body!)).toEqual({ speedScale: 1, outputSamplingRate: 24000 })
  })

  it('counts an engine that answers with no voices as not running', async () => {
    vi.stubGlobal('fetch', async (url: string) => Response.json(url.includes(':10101') ? [] : speakers['http://127.0.0.1:50021']))
    const found = await probeEngines({ voicevox: 'http://127.0.0.1:50021', aivis: 'http://127.0.0.1:10101' })
    expect(found.up).toEqual(['voicevox'])
  })
})

describe('turning engines on', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const m = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    })
    return m
  }

  it('keeps a device that turned VOICEVOX on before AivisSpeech existed on, now with AivisSpeech too', () => {
    memoryStorage({ 'kikitori.voicevox': 'http://127.0.0.1:50021' })
    expect(engineUrls()).toEqual({ voicevox: 'http://127.0.0.1:50021', aivis: 'http://127.0.0.1:10101' })
  })

  it('is off until turned on, and off again after', () => {
    const m = memoryStorage()
    expect(engineUrls()).toBeNull()
    setEnginesOn(true)
    expect(engineUrls()).toEqual({ voicevox: 'http://127.0.0.1:50021', aivis: 'http://127.0.0.1:10101' })
    setEnginesOn(false)
    expect(engineUrls()).toBeNull()
    expect(m.size).toBe(0)
  })
})
