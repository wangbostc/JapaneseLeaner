import { isNeuralVoiceId, MAX_TTS_CHARS, NEURAL_VOICES } from '../src/lib/voices'
import type { Env } from './env'

/**
 * Natural Japanese speech from Azure's neural voices (its free F0 tier covers 500k characters a month).
 * Every sentence is synthesised once per voice and kept in R2, so replays cost nothing.
 */

export const ttsEnabled = (env: Env) => Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION)

export const ttsInfo = (env: Env) => ({ enabled: ttsEnabled(env), voices: ttsEnabled(env) ? NEURAL_VOICES : [] })

// Mono MP3 at 24 kHz: small, and every browser plays it.
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

const fail = (status: number, code: string) => Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } })

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

export const ssml = (voice: string, text: string) =>
  `<speak version='1.0' xml:lang='ja-JP'><voice xml:lang='ja-JP' name='${voice}'>${escapeXml(text)}</voice></speak>`

async function cacheKey(voice: string, text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${OUTPUT_FORMAT}\n${voice}\n${text}`))
  return `tts/${voice}/${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}.mp3`
}

const audio = (body: ReadableStream | ArrayBuffer, type: string) =>
  new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' } })

export async function speech(env: Env, body: Record<string, unknown> | null, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!ttsEnabled(env)) return fail(503, 'serverOff')
  const voice = body?.voice
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
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
