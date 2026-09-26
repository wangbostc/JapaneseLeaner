import { engineOf, isEngineVoiceId, isNeuralVoiceId, MAX_TTS_CHARS, NEURAL_VOICES, type EngineVoice } from '../src/lib/voices'
import type { Env } from './env'

/**
 * Natural Japanese speech, kept in R2 per sentence and voice:
 * - Azure neural voices, synthesised here (its free F0 tier covers 500k characters a month);
 * - VOICEVOX and AivisSpeech voices, made on the learner's own computer and uploaded
 *   (PUT /api/tts/clip), so their other devices can play them. The server only stores and serves those.
 */

export const ttsEnabled = (env: Env) => Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION)

// The list of voices clips were made with (both engines; the name predates AivisSpeech).
const VOICEVOX_VOICES_KEY = 'tts/voicevox/voices.json'
const MAX_PREPARED_VOICES = 20
/** A clip is one sentence of 24 kHz WAV (~50 KB a second); this is several minutes. */
export const MAX_CLIP_BYTES = 10 * 1024 * 1024

async function preparedVoices(env: Env): Promise<EngineVoice[]> {
  const obj = await env.FILES.get(VOICEVOX_VOICES_KEY)
  if (!obj) return []
  try {
    const list = (await obj.json()) as EngineVoice[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Azure's voices when it's configured, and the engine voices with clips here, most recently used first. */
export const ttsInfo = async (env: Env) => ({ enabled: ttsEnabled(env), voices: ttsEnabled(env) ? NEURAL_VOICES : [], prepared: await preparedVoices(env) })

// Mono MP3 at 24 kHz: small, and every browser plays it.
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

const fail = (status: number, code: string) => Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } })

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

export const ssml = (voice: string, text: string) =>
  `<speak version='1.0' xml:lang='ja-JP'><voice xml:lang='ja-JP' name='${voice}'>${escapeXml(text)}</voice></speak>`

async function cacheKey(voice: string, text: string) {
  // VOICEVOX clips keep the key they were first stored under.
  const format = isEngineVoiceId(voice) ? `${engineOf(voice)}-wav` : OUTPUT_FORMAT
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${format}\n${voice}\n${text}`))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return isEngineVoiceId(voice) ? `tts/${voice.replace(':', '-')}/${hex}.wav` : `tts/${voice}/${hex}.mp3`
}

const audio = (body: ReadableStream | ArrayBuffer, type: string) =>
  new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' } })

export async function speech(env: Env, body: Record<string, unknown> | null, fetcher: typeof fetch = fetch): Promise<Response> {
  const voice = body?.voice
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (typeof voice === 'string' && isEngineVoiceId(voice)) {
    // Made elsewhere: serve it if it's been uploaded; the device's own voice covers the rest.
    if (!text) return fail(400, 'invalid')
    if (text.length > MAX_TTS_CHARS) return fail(400, 'tooLong')
    const clip = await env.FILES.get(await cacheKey(voice, text))
    return clip ? audio(clip.body, clip.httpMetadata?.contentType ?? 'audio/wav') : fail(404, 'notPrepared')
  }
  if (!ttsEnabled(env)) return fail(503, 'serverOff')
  if (typeof voice !== 'string' || !isNeuralVoiceId(voice) || !text) return fail(400, 'invalid')
  if (text.length > MAX_TTS_CHARS) return fail(400, 'tooLong')

  const key = await cacheKey(voice, text)
  const cached = await env.FILES.get(key)
  if (cached) return audio(cached.body, cached.httpMetadata?.contentType ?? 'audio/mpeg')

  const endpoint = env.AZURE_SPEECH_ENDPOINT ?? `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`
  let res: Response
  try {
    res = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
        'User-Agent': 'kikitori',
      },
      body: ssml(voice, text),
    })
  } catch {
    return fail(502, 'network')
  }
  if (!res.ok) {
    // The server's key or region is wrong, or its free quota is used up for the month.
    if (res.status === 401 || res.status === 403) return fail(502, 'serverKey')
    if (res.status === 429) return fail(429, 'rateLimit')
    return fail(502, 'api')
  }
  const bytes = await res.arrayBuffer()
  if (!bytes.byteLength) return fail(502, 'api')
  const type = res.headers.get('Content-Type') ?? 'audio/mpeg'
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } })
  return audio(bytes, type)
}

/**
 * Stores an engine clip (VOICEVOX or AivisSpeech) made on the learner's computer: PUT /api/tts/clip?voice=&text=[&name=&speaker=]
 * with the audio as the body. `name` and `speaker` put the voice on the list other devices choose from.
 */
export async function putClip(env: Env, request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams
  const voice = q.get('voice') ?? ''
  const text = (q.get('text') ?? '').trim()
  const name = q.get('name')
  const speaker = q.get('speaker')
  if (!isEngineVoiceId(voice) || !text) return fail(400, 'invalid')
  if (text.length > MAX_TTS_CHARS) return fail(400, 'tooLong')
  if ((name !== null || speaker !== null) && !(name && speaker && name.length <= 80 && speaker.length <= 80)) return fail(400, 'invalid')
  const type = request.headers.get('Content-Type') ?? ''
  if (!/^audio\/[\w.+-]+$/.test(type)) return fail(415, 'invalid')
  // A clip is a Blob, which always has a length; refusing unknown lengths means nothing is buffered past the cap.
  const length = request.headers.get('Content-Length')
  if (length === null) return fail(411, 'invalid')
  if (Number(length) > MAX_CLIP_BYTES) return fail(413, 'tooLong')
  const bytes = await request.arrayBuffer()
  if (!bytes.byteLength) return fail(400, 'invalid')
  if (bytes.byteLength > MAX_CLIP_BYTES) return fail(413, 'tooLong')
  await env.FILES.put(await cacheKey(voice, text), bytes, { httpMetadata: { contentType: type } })
  if (name && speaker) {
    const list = await preparedVoices(env)
    if (list[0]?.id !== voice || list[0]?.name !== name) {
      const next = [{ id: voice, name, speaker }, ...list.filter((v) => v.id !== voice)].slice(0, MAX_PREPARED_VOICES)
      await env.FILES.put(VOICEVOX_VOICES_KEY, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } })
    }
  }
  return Response.json({ stored: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
