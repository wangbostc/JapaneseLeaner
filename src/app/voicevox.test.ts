import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeEngine, synthesize } from './voicevox'

afterEach(() => vi.unstubAllGlobals())

describe('VOICEVOX engine', () => {
  it('lists each talking style as a voice, named for the character and style', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('http://127.0.0.1:50021/speakers')
      return Response.json([
        { name: 'No.7', styles: [{ name: 'ノーマル', id: 29, type: 'talk' }, { name: 'アナウンス', id: 30, type: 'talk' }] },
        { name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }, { name: 'ハミング', id: 3001, type: 'humming' }] },
      ])
    })
    expect(await probeEngine('http://127.0.0.1:50021')).toEqual([
      { id: 'voicevox:29', name: 'No.7（ノーマル）', speaker: 'No.7' },
      { id: 'voicevox:30', name: 'No.7（アナウンス）', speaker: 'No.7' },
      { id: 'voicevox:3', name: 'ずんだもん（ノーマル）', speaker: 'ずんだもん' },
    ])
  })

  it('is absent when nothing answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await probeEngine('http://127.0.0.1:50021')).toBeNull()
  })

  it('synthesises with the query the engine made for the text', async () => {
    const calls: { url: string; body?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined })
      return url.includes('audio_query') ? Response.json({ speedScale: 1 }) : new Response(new Blob(['RIFF'], { type: 'audio/wav' }))
    })
    const blob = await synthesize('http://127.0.0.1:50021', 'voicevox:30', '一。')
    expect(blob.type).toBe('audio/wav')
    expect(calls.map((c) => c.url)).toEqual([
      `http://127.0.0.1:50021/audio_query?speaker=30&text=${encodeURIComponent('一。')}`,
      'http://127.0.0.1:50021/synthesis?speaker=30',
    ])
    expect(JSON.parse(calls[1].body!)).toEqual({ speedScale: 1 })
  })
})
