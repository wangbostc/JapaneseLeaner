import { afterEach, describe, expect, it } from 'vitest'
import { handleApi } from './index'
import { putClip, speech, ssml, ttsInfo } from './tts'
import { testEnv } from './testEnv'

let dispose: (() => Promise<void>) | null = null
afterEach(async () => {
  await dispose?.()
  dispose = null
})

const AZURE = { AZURE_SPEECH_KEY: 'azure-key', AZURE_SPEECH_REGION: 'japaneast' }

async function env(extra = {}) {
  const t = await testEnv({ ...AZURE, ...extra })
  dispose = t.dispose
  return t.env
}

/** A fake Azure that records each call and answers with fixed bytes. */
function fakeAzure(reply: () => Response = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } })) {
  const calls: { url: string; headers: Headers; body: string }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers), body: String(init.body) })
    return reply()
  }) as typeof fetch
  return { calls, fetcher }
}

describe('/api/tts', () => {
  it('synthesises with the server key and the chosen voice, as mp3', async () => {
    const e = await env()
    const azure = fakeAzure()
    const res = await speech(e, { text: '私は学生です。', voice: 'ja-JP-KeitaNeural' }, azure.fetcher)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3])
    expect(azure.calls).toHaveLength(1)
    const [call] = azure.calls
    expect(call.url).toBe('https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1')
    expect(call.headers.get('Ocp-Apim-Subscription-Key')).toBe('azure-key')
    expect(call.headers.get('X-Microsoft-OutputFormat')).toBe('audio-24khz-48kbitrate-mono-mp3')
    expect(call.body).toBe(ssml('ja-JP-KeitaNeural', '私は学生です。'))
    expect(call.body).toContain("name='ja-JP-KeitaNeural'>私は学生です。</voice>")
  })

  it('synthesises each sentence once per voice, then serves it from storage', async () => {
    const e = await env()
    const azure = fakeAzure()
    const body = { text: 'おはよう。', voice: 'ja-JP-NanamiNeural' }
    await (await speech(e, body, azure.fetcher)).arrayBuffer()
    const again = await speech(e, { ...body, text: '  おはよう。 ' }, azure.fetcher)
    expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([1, 2, 3])
    expect(azure.calls).toHaveLength(1)
    // Another voice is another recording.
    await (await speech(e, { ...body, voice: 'ja-JP-AoiNeural' }, azure.fetcher)).arrayBuffer()
    expect(azure.calls).toHaveLength(2)
  })

  it('escapes the text, so it cannot break out of the SSML', async () => {
    expect(ssml('ja-JP-NanamiNeural', `A&B <voice name='x'>"`)).toBe(
      "<speak version='1.0' xml:lang='ja-JP'><voice xml:lang='ja-JP' name='ja-JP-NanamiNeural'>A&amp;B &lt;voice name=&apos;x&apos;&gt;&quot;</voice></speak>",
    )
  })

  it('refuses unknown voices, empty and overlong text', async () => {
    const e = await env()
    const azure = fakeAzure()
    const code = async (body: Record<string, unknown> | null) => {
      const res = await speech(e, body, azure.fetcher)
      return [res.status, ((await res.json()) as { error: string }).error]
    }
    expect(await code(null)).toEqual([400, 'invalid'])
    expect(await code({ text: 'はい', voice: 'en-US-JennyNeural' })).toEqual([400, 'invalid'])
    expect(await code({ text: 'はい', voice: 'ja-JP-Nanami:DragonHDLatestNeural' })).toEqual([400, 'invalid'])
    expect(await code({ text: '   ', voice: 'ja-JP-NanamiNeural' })).toEqual([400, 'invalid'])
    expect(await code({ text: 'あ'.repeat(1001), voice: 'ja-JP-NanamiNeural' })).toEqual([400, 'tooLong'])
    expect(azure.calls).toHaveLength(0)
  })

  it('maps Azure failures to codes and stores nothing', async () => {
    const e = await env()
    for (const [status, expected] of [
      [401, [502, 'serverKey']],
      [429, [429, 'rateLimit']],
      [500, [502, 'api']],
    ] as const) {
      const azure = fakeAzure(() => new Response('no', { status }))
      const res = await speech(e, { text: 'だめ。', voice: 'ja-JP-NanamiNeural' }, azure.fetcher)
      expect([res.status, ((await res.json()) as { error: string }).error]).toEqual(expected)
    }
    // A later success is fetched fresh: the failures weren't cached.
    const azure = fakeAzure()
    expect((await speech(e, { text: 'だめ。', voice: 'ja-JP-NanamiNeural' }, azure.fetcher)).status).toBe(200)
    expect(azure.calls).toHaveLength(1)
  })

  it('is off without a key or region', async () => {
    for (const off of [{ AZURE_SPEECH_KEY: undefined }, { AZURE_SPEECH_REGION: undefined }]) {
      const e = await env(off)
      const azure = fakeAzure()
      expect((await speech(e, { text: 'はい', voice: 'ja-JP-NanamiNeural' }, azure.fetcher)).status).toBe(503)
      expect(azure.calls).toHaveLength(0)
      await dispose?.()
      dispose = null
    }
  })

  it('tells connected devices whether natural voices are on, and only devices may use them', async () => {
    const e = await env({ SETUP_CODE: 'tts-test-setup-code' })
    const reg = await handleApi(
      new Request('https://k.test/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupCode: 'tts-test-setup-code', name: 't' }) }),
      e,
    )
    const { token } = (await reg.json()) as { token: string }
    const get = (en: typeof e) => handleApi(new Request('https://k.test/api/tts', { headers: { Authorization: `Bearer ${token}` } }), en).then((r) => r.json())
    const on = (await get(e)) as { enabled: boolean; voices: { id: string }[] }
    expect(on.enabled).toBe(true)
    expect(on.voices.map((v) => v.id)).toContain('ja-JP-NanamiNeural')
    expect(await get({ ...e, AZURE_SPEECH_KEY: undefined })).toEqual({ enabled: false, voices: [], prepared: [] })
    const anon = await handleApi(new Request('https://k.test/api/tts', { method: 'POST', body: '{}' }), e)
    expect(anon.status).toBe(401)
  })
})

describe('VOICEVOX clips', () => {
  // A browser sends Content-Length for a Blob body; a Request built here doesn't, so set it as the browser would.
  const put = (e: Awaited<ReturnType<typeof env>>, query: Record<string, string>, body: Uint8Array | string = new Uint8Array([9, 8, 7]), type = 'audio/wav', length: string | null = String(typeof body === 'string' ? new TextEncoder().encode(body).length : body.length)) =>
    putClip(
      e,
      new Request(`https://k.test/api/tts/clip?${new URLSearchParams(query)}`, {
        method: 'PUT',
        body,
        headers: { ...(type ? { 'Content-Type': type } : {}), ...(length !== null ? { 'Content-Length': length } : {}) },
      }),
    )
  const status = async (res: Response) => [res.status, res.ok ? null : ((await res.json()) as { error: string }).error]

  it('serves a clip made on the learner’s computer to their other devices, without Azure', async () => {
    const e = await env({ AZURE_SPEECH_KEY: undefined })
    const azure = fakeAzure()
    expect(await status(await speech(e, { text: '私は学生です。', voice: 'voicevox:30' }, azure.fetcher))).toEqual([404, 'notPrepared'])
    expect((await put(e, { voice: 'voicevox:30', text: '私は学生です。' })).status).toBe(201)
    const res = await speech(e, { text: ' 私は学生です。 ', voice: 'voicevox:30' }, azure.fetcher)
    expect(res.headers.get('Content-Type')).toBe('audio/wav')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([9, 8, 7])
    // Another voice's clip is another clip; Azure is never asked for VOICEVOX voices.
    expect(await status(await speech(e, { text: '私は学生です。', voice: 'voicevox:3' }, azure.fetcher))).toEqual([404, 'notPrepared'])
    expect(azure.calls).toHaveLength(0)
  })

  it('lists the voices clips were made with, most recent first', async () => {
    const e = await env()
    const info = async () => (await ttsInfo(e)).prepared
    expect(await info()).toEqual([])
    await put(e, { voice: 'voicevox:30', text: '一。', name: 'No.7（アナウンス）', speaker: 'No.7' })
    await put(e, { voice: 'voicevox:3', text: '二。', name: 'ずんだもん（ノーマル）', speaker: 'ずんだもん' })
    await put(e, { voice: 'voicevox:30', text: '三。', name: 'No.7（アナウンス）', speaker: 'No.7' })
    await put(e, { voice: 'voicevox:3', text: '四。' }) // no name: stored, list unchanged
    expect(await info()).toEqual([
      { id: 'voicevox:30', name: 'No.7（アナウンス）', speaker: 'No.7' },
      { id: 'voicevox:3', name: 'ずんだもん（ノーマル）', speaker: 'ずんだもん' },
    ])
  })

  it('refuses bad uploads', async () => {
    const e = await env()
    expect(await status(await put(e, { voice: 'ja-JP-NanamiNeural', text: 'はい' }))).toEqual([400, 'invalid'])
    expect(await status(await put(e, { voice: 'voicevox:abc', text: 'はい' }))).toEqual([400, 'invalid'])
    expect(await status(await put(e, { voice: 'coeiroink:3', text: 'はい' }))).toEqual([400, 'invalid'])
    expect(await status(await put(e, { voice: 'voicevox:3', text: '  ' }))).toEqual([400, 'invalid'])
    expect(await status(await put(e, { voice: 'voicevox:3', text: 'あ'.repeat(1001) }))).toEqual([400, 'tooLong'])
    expect(await status(await put(e, { voice: 'voicevox:3', text: 'はい' }, '<html>', 'text/html'))).toEqual([415, 'invalid'])
    expect(await status(await put(e, { voice: 'voicevox:3', text: 'はい' }, new Uint8Array(0)))).toEqual([400, 'invalid'])
    expect(await status(await put(e, { voice: 'voicevox:3', text: 'はい', name: 'x' }))).toEqual([400, 'invalid'])
    expect(await status(await put(e, { voice: 'voicevox:3', text: 'はい' }, new Uint8Array(10 * 1024 * 1024 + 1)))).toEqual([413, 'tooLong'])
    expect(await status(await put(e, { voice: 'voicevox:3', text: 'はい' }, new Uint8Array([1]), 'audio/wav', null))).toEqual([411, 'invalid'])
    expect(await status(await speech(e, { text: 'はい', voice: 'voicevox:3' }))).toEqual([404, 'notPrepared'])
  })

  it('only devices may upload', async () => {
    const e = await env({ SETUP_CODE: 'tts-test-setup-code' })
    const res = await handleApi(new Request('https://k.test/api/tts/clip?voice=voicevox:3&text=x', { method: 'PUT', body: 'x', headers: { 'Content-Type': 'audio/wav' } }), e)
    expect(res.status).toBe(401)
  })
})

describe('AivisSpeech clips', () => {
  it('are stored and served like VOICEVOX ones, as a separate voice', async () => {
    const e = await env({ AZURE_SPEECH_KEY: undefined })
    const put = (voice: string, bytes: number[], extra: Record<string, string> = {}) =>
      putClip(
        e,
        new Request(`https://k.test/api/tts/clip?${new URLSearchParams({ voice, text: '一。', ...extra })}`, {
          method: 'PUT',
          body: new Uint8Array(bytes),
          headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(bytes.length) },
        }),
      )
    expect((await put('aivis:888753760', [1, 1], { name: 'まお（ノーマル）', speaker: 'まお' })).status).toBe(201)
    expect((await put('voicevox:13', [2, 2])).status).toBe(201)
    const get = async (voice: string) => [...new Uint8Array(await (await speech(e, { text: '一。', voice })).arrayBuffer())]
    expect(await get('aivis:888753760')).toEqual([1, 1])
    expect(await get('voicevox:13')).toEqual([2, 2])
    expect((await ttsInfo(e)).prepared).toEqual([{ id: 'aivis:888753760', name: 'まお（ノーマル）', speaker: 'まお' }])
    // VOICEVOX clips uploaded before AivisSpeech keep their R2 key, so they're still found.
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('voicevox-wav\nvoicevox:13\n一。')))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const keys = (await e.FILES.list({ prefix: 'tts/' })).objects.map((o) => o.key)
    expect(keys).toContain(`tts/voicevox-13/${hex}.wav`)
    expect(keys.some((k) => k.startsWith('tts/aivis-888753760/'))).toBe(true)
  })
})
