import { describe, expect, it } from 'vitest'
import { cacheUrl, defaultVoice, neuralSynth, parseRemembered, prepareClips } from './neuralVoice'
import { NEURAL_VOICES } from '../lib/voices'

/** Just enough of Cache Storage: match/put by URL. */
function memoryCache() {
  const entries = new Map<string, Response>()
  const cache = {
    match: async (url: string) => entries.get(url)?.clone(),
    put: async (url: string, res: Response) => void entries.set(url, res),
  } as unknown as Cache
  Object.assign(cache, {
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    delete: async (req: Request) => entries.delete(req.url),
  })
  return { entries, open: async () => cache }
}

function fakeServer(reply: () => Response = () => new Response(new Blob(['mp3'], { type: 'audio/mpeg' }))) {
  const calls: unknown[] = []
  const api = async (path: string, init?: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(init?.body)) })
    return reply()
  }
  return { calls, api }
}

describe('neuralSynth', () => {
  it('asks the server once per sentence and voice, then plays from the device cache', async () => {
    const server = fakeServer()
    const cache = memoryCache()
    const synth = neuralSynth(server.api, cache.open)
    expect(await (await synth('おはよう。', 'ja-JP-NanamiNeural')).text()).toBe('mp3')
    expect(server.calls).toEqual([{ path: '/api/tts', body: { text: 'おはよう。', voice: 'ja-JP-NanamiNeural' } }])
    expect(await (await synth(' おはよう。 ', 'ja-JP-NanamiNeural')).text()).toBe('mp3')
    expect(server.calls).toHaveLength(1)
    await synth('おはよう。', 'ja-JP-KeitaNeural')
    expect(server.calls).toHaveLength(2)
    expect(cache.entries.size).toBe(2)
  })

  it('shares one request between a prefetch and the play that follows it', async () => {
    const server = fakeServer()
    const synth = neuralSynth(server.api, async () => null)
    await Promise.all([synth('こんばんは。', 'ja-JP-AoiNeural'), synth('こんばんは。', 'ja-JP-AoiNeural')])
    expect(server.calls).toHaveLength(1)
  })

  it('reports the server’s error code and caches nothing', async () => {
    const cache = memoryCache()
    const synth = neuralSynth(fakeServer(() => Response.json({ error: 'rateLimit' }, { status: 429 })).api, cache.open)
    await expect(synth('だめ。', 'ja-JP-NanamiNeural')).rejects.toThrow('rateLimit')
    expect(cache.entries.size).toBe(0)
  })

  it('lets a caller stop waiting without cancelling the shared request', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const server = fakeServer()
    const synth = neuralSynth(async (p, i) => (await gate, server.api(p, i)), async () => null)
    const stop = new AbortController()
    const waiting = synth('ながい。', 'ja-JP-NanamiNeural', stop.signal)
    const other = synth('ながい。', 'ja-JP-NanamiNeural')
    stop.abort()
    await expect(waiting).rejects.toThrow('aborted')
    release()
    expect(await (await other).text()).toBe('mp3')
    expect(server.calls).toHaveLength(1)
  })

  it('keeps the device cache under its cap, dropping the oldest sentences first', async () => {
    const cache = memoryCache()
    const synth = neuralSynth(fakeServer().api, cache.open, 2)
    for (const text of ['一。', '二。', '三。']) await synth(text, 'ja-JP-NanamiNeural')
    expect(cache.entries.size).toBe(2)
    const server = fakeServer()
    const again = neuralSynth(server.api, cache.open, 2)
    await again('三。', 'ja-JP-NanamiNeural') // newest: still cached
    expect(server.calls).toHaveLength(0)
    await again('一。', 'ja-JP-NanamiNeural') // oldest: dropped, so fetched again
    expect(server.calls).toHaveLength(1)
  })

  it('gives the server request a deadline, so a hung server hands over to the device voice', async () => {
    let signal: AbortSignal | undefined
    const synth = neuralSynth(async (_p, init) => ((signal = init?.signal ?? undefined), new Response(new Blob(['x']))), async () => null)
    await synth('はい。', 'ja-JP-NanamiNeural')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal!.aborted).toBe(false)
  })

  it('makes a VOICEVOX sentence on this computer and uploads it for the other devices', async () => {
    const engine = { url: 'http://127.0.0.1:50021', voices: [{ id: 'voicevox:30' as const, name: 'No.7（アナウンス）', speaker: 'No.7' }] }
    const calls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).split('?')[0]}`)
      if (String(url).includes('/audio_query')) return Response.json({ accent_phrases: [] })
      return new Response(new Blob(['wav'], { type: 'audio/wav' }))
    }) as typeof fetch
    try {
      const uploads: { path: string; type: string | null }[] = []
      const api = async (path: string, init?: RequestInit) => {
        uploads.push({ path, type: new Headers(init?.headers).get('Content-Type') })
        return Response.json({ stored: true }, { status: 201 })
      }
      const cache = memoryCache()
      const synth = neuralSynth(api, cache.open, 100, () => engine)
      expect(await (await synth('私は学生です。', 'voicevox:30')).text()).toBe('wav')
      expect(calls).toEqual(['POST http://127.0.0.1:50021/audio_query', 'POST http://127.0.0.1:50021/synthesis'])
      await new Promise((r) => setTimeout(r, 0)) // the upload is best effort, in the background
      expect(uploads).toHaveLength(1)
      const q = new URLSearchParams(uploads[0].path.split('?')[1])
      expect(uploads[0].path.startsWith('/api/tts/clip?')).toBe(true)
      expect(Object.fromEntries(q)).toEqual({ voice: 'voicevox:30', text: '私は学生です。', name: 'No.7（アナウンス）', speaker: 'No.7' })
      expect(uploads[0].type).toBe('audio/wav')
      // Played again: from the device cache, no engine call and no second upload.
      await synth('私は学生です。', 'voicevox:30')
      expect(calls).toHaveLength(2)
      expect(uploads).toHaveLength(1)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('asks the server for a VOICEVOX clip when the engine has stopped, or on a device without one', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    try {
      const server = fakeServer()
      const engine = { url: 'http://127.0.0.1:50021', voices: [] }
      expect(await (await neuralSynth(server.api, async () => null, 100, () => engine)('はい。', 'voicevox:30')).text()).toBe('mp3')
      expect(await (await neuralSynth(server.api, async () => null, 100, () => null)('いいえ。', 'voicevox:30')).text()).toBe('mp3')
      expect(server.calls).toEqual([
        { path: '/api/tts', body: { text: 'はい。', voice: 'voicevox:30' } },
        { path: '/api/tts', body: { text: 'いいえ。', voice: 'voicevox:30' } },
      ])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('reports a clip the server doesn’t have once, then lets the device voice speak without asking again', async () => {
    const server = fakeServer(() => Response.json({ error: 'notPrepared' }, { status: 404 }))
    const synth = neuralSynth(server.api, async () => null, 100, () => null)
    await expect(synth('未準備。', 'voicevox:30')).rejects.toThrow('notPrepared')
    await expect(synth('未準備。', 'voicevox:30')).rejects.toThrow('notPrepared')
    expect(server.calls).toHaveLength(1)
  })
})

describe('device cache keys', () => {
  it('keeps the key Azure clips were cached under before VOICEVOX, so they still play', async () => {
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ja-JP-NanamiNeural\nおはよう。')))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    expect(await cacheUrl('ja-JP-NanamiNeural', 'おはよう。')).toBe(`https://tts.kikitori.invalid/ja-JP-NanamiNeural/${hex}.mp3`)
    expect(await cacheUrl('voicevox:30', 'おはよう。')).toMatch(/^https:\/\/tts\.kikitori\.invalid\/voicevox-30\/[0-9a-f]{64}\.wav$/)
  })
})

describe('defaultVoice', () => {
  const vv = (n: number, speaker = 'x') => ({ id: `voicevox:${n}` as const, name: `v${n}`, speaker })
  it('is Nanami when the server has Azure', () => {
    expect(defaultVoice(NEURAL_VOICES, [vv(29), vv(30)], [vv(3)])).toBe('ja-JP-NanamiNeural')
  })
  it('is No.7 アナウンス on a computer whose engine has it, else the engine’s first voice', () => {
    expect(defaultVoice(null, [vv(29), vv(30), vv(3)], [])).toBe('voicevox:30')
    expect(defaultVoice(null, [vv(3), vv(8)], [vv(30)])).toBe('voicevox:3')
  })
  it('is the most recently prepared voice on a device without an engine, else none', () => {
    expect(defaultVoice(null, null, [vv(8), vv(30)])).toBe('voicevox:8')
    expect(defaultVoice(null, null, [])).toBeUndefined()
  })
})

describe('parseRemembered', () => {
  it('reads the list saved before VOICEVOX (a bare Azure array), so an offline start keeps natural voices', () => {
    expect(parseRemembered(JSON.stringify(NEURAL_VOICES))).toEqual({ azure: NEURAL_VOICES, prepared: [] })
  })
  it('reads the current form, and tolerates junk', () => {
    const prepared = [{ id: 'voicevox:30', name: 'No.7（アナウンス）', speaker: 'No.7' }]
    expect(parseRemembered(JSON.stringify({ azure: null, prepared }))).toEqual({ azure: null, prepared })
    expect(parseRemembered('{oops')).toEqual({ azure: null, prepared: [] })
    expect(parseRemembered(null)).toEqual({ azure: null, prepared: [] })
    expect(parseRemembered('[]')).toEqual({ azure: null, prepared: [] })
  })
})

describe('prepareClips', () => {
  it('uploads every sentence once, re-uploading ones cached here without asking the engine again', async () => {
    const engine = { url: 'http://127.0.0.1:50021', voices: [{ id: 'voicevox:30' as const, name: 'No.7（アナウンス）', speaker: 'No.7' }] }
    const cache = memoryCache()
    // 一。 was played earlier (maybe offline) and is only in the device cache.
    const cached = await cache.open()
    await cached!.put(await cacheUrl('voicevox:30', '一。'), new Response(new Blob(['cached'], { type: 'audio/wav' })))
    const engineCalls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      engineCalls.push(String(url).split('?')[0])
      return String(url).includes('audio_query') ? Response.json({}) : new Response(new Blob(['fresh'], { type: 'audio/wav' }))
    }) as typeof fetch
    try {
      const uploaded: { text: string; body: string }[] = []
      const api = async (path: string, init?: RequestInit) => {
        uploaded.push({ text: new URLSearchParams(path.split('?')[1]).get('text')!, body: await (init!.body as Blob).text() })
        return Response.json({ stored: true }, { status: 201 })
      }
      const progress: number[] = []
      await prepareClips(['一。', ' 二。', '一。', ''], 'voicevox:30', (n) => progress.push(n), { api, eng: engine, cache: cache.open, refresh: async () => {} })
      expect(uploaded).toEqual([
        { text: '一。', body: 'cached' },
        { text: '二。', body: 'fresh' },
      ])
      expect(engineCalls).toEqual(['http://127.0.0.1:50021/audio_query', 'http://127.0.0.1:50021/synthesis']) // only for 二。
      expect(progress).toEqual([1, 2])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('says why it can’t run', async () => {
    const api = async () => new Response()
    await expect(prepareClips(['一。'], 'voicevox:30', () => {}, { api: null, eng: null })).rejects.toThrow('notConnected')
    await expect(prepareClips(['一。'], 'voicevox:30', () => {}, { api, eng: null })).rejects.toThrow('engineOff')
  })
})
