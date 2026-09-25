import { afterEach, describe, expect, it } from 'vitest'
import { handleApi } from './index'
import { speech, ssml } from './tts'
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
    expect(await get({ ...e, AZURE_SPEECH_KEY: undefined })).toEqual({ enabled: false, voices: [] })
    const anon = await handleApi(new Request('https://k.test/api/tts', { method: 'POST', body: '{}' }), e)
    expect(anon.status).toBe(401)
  })
})
