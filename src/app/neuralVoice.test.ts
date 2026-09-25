import { describe, expect, it } from 'vitest'
import { neuralSynth } from './neuralVoice'

/** Just enough of Cache Storage: match/put by URL. */
function memoryCache() {
  const entries = new Map<string, Response>()
  const cache = {
    match: async (url: string) => entries.get(url)?.clone(),
    put: async (url: string, res: Response) => void entries.set(url, res),
  } as unknown as Cache
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
})
