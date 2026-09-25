import { describe, expect, it } from 'vitest'
import { neuralSynth } from './neuralVoice'

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
})
