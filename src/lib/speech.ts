/**
 * Browser speech I/O behind small seams. Everything is feature-detected:
 * Firefox has no SpeechRecognition, Chrome's needs a network, Safari's is
 * prefixed, and a device may have no Japanese TTS voice at all.
 *
 * `window.__kikitoriFake` replaces recognition and TTS for end-to-end tests,
 * where there is no microphone and no voice.
 */

import { DEFAULT_NEURAL_VOICE, neuralVoiceOf, type NeuralVoiceId } from './voices'

interface FakeSpeech {
  /** What the "recogniser" hears for each attempt. */
  transcript: () => string
}

declare global {
  interface Window {
    __kikitoriFake?: FakeSpeech
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
    SpeechRecognition?: new () => SpeechRecognitionLike
  }
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

const fake = () => (typeof window !== 'undefined' ? window.__kikitoriFake : undefined)

const Recognition = () => (typeof window === 'undefined' ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition))

export const recognitionSupported = () => Boolean(fake() || Recognition())

export interface Listening {
  /** Stop listening; `result` then resolves with everything heard. */
  stop(): void
  result: Promise<string>
}

export function listen(onInterim?: (text: string) => void): Listening {
  const f = fake()
  if (f) {
    let done: (t: string) => void = () => {}
    const result = new Promise<string>((r) => (done = r))
    return { stop: () => done(f.transcript()), result }
  }
  const Ctor = Recognition()
  if (!Ctor) throw new Error('SpeechRecognition unsupported')
  const rec = new Ctor()
  rec.lang = 'ja-JP'
  rec.continuous = true
  rec.interimResults = true
  const finals: string[] = []
  let interim = ''
  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finals[i] = r[0].transcript
        else interim += r[0].transcript
      }
      onInterim?.(finals.join('') + interim)
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      reject(new Error(e.error))
    }
    rec.onend = () => resolve(finals.join('') + interim)
  })
  rec.start()
  return { stop: () => rec.stop(), result }
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export const recordingSupported = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

export interface Recording {
  stop(): Promise<Blob>
}

/** Record from the mic in whatever container this browser supports (webm on Chrome, mp4 on Safari). */
export async function record(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t))
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start()
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(new Blob(chunks, { type: rec.mimeType }))
        }
        rec.stop()
      }),
  }
}

// --- Text to speech -------------------------------------------------------

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null

// Device voices differ a lot in quality. Network/neural voices (Edge's "Natural", Chrome's
// "Google 日本語") and the downloadable Siri/Enhanced/Premium voices sound far better than the
// small built-in ones (macOS "Kyoko"/"Otoya" compact, Windows "Haruka Desktop"). macOS also
// lists its novelty voices (Eddy, Grandma, Rocko…) for Japanese; they come last.
const NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i
const voiceScore = (v: SpeechSynthesisVoice, online: boolean) => {
  // A network voice says nothing offline, so then any voice on the device beats it.
  if (!online && v.localService === false) return -1
  const n = v.name
  if (NOVELTY.test(n)) return 0
  if (/natural|neural/i.test(n)) return 5
  if (/premium|enhanced|siri/i.test(n) || /premium|enhanced/i.test(v.voiceURI)) return 4
  if (/google/i.test(n)) return 3
  if (/compact|desktop|espeak/i.test(n)) return 1
  return 2
}

/** Japanese voices, best first (the sort is stable, so the browser's order breaks ties). */
export const rankVoices = (voices: SpeechSynthesisVoice[], online = typeof navigator === 'undefined' || navigator.onLine !== false) =>
  [...voices].sort((a, b) => voiceScore(b, online) - voiceScore(a, online))

/** Japanese voices, best first right now (online or not); the list fills in asynchronously on most browsers. */
export function japaneseVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([])
  voicesReady ??= new Promise((resolve) => {
    const pick = () => speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('ja'))
    if (speechSynthesis.getVoices().length) return resolve(pick())
    const timer = setTimeout(() => resolve(pick()), 1500)
    speechSynthesis.addEventListener('voiceschanged', () => (clearTimeout(timer), resolve(pick())), { once: true })
  })
  return voicesReady.then((v) => rankVoices(v))
}

/** Rough spoken duration, used as a safety net when TTS never fires `end`. */
export const estimateSpeechMs = (text: string, rate: number) => (text.length * 160) / rate + 600

// --- Natural voices (from the server) --------------------------------------

/** Fetches one sentence's audio in a natural voice (src/app/neuralVoice.ts, when the server offers them). */
export type NeuralSynth = (text: string, voice: NeuralVoiceId, signal?: AbortSignal) => Promise<Blob>

let neural: NeuralSynth | null = null

/** Turns natural voices on (connected to a server that has them) or off. */
export function setNeuralSynth(synth: NeuralSynth | null) {
  neural = synth
}

/**
 * The natural voice to speak with, or null for the device's own voice. With natural voices on,
 * they're the default; a device voice chosen explicitly in Settings still wins.
 */
export function neuralChoice(voiceURI: string | undefined): NeuralVoiceId | null {
  if (!neural) return null
  if (voiceURI === undefined) return DEFAULT_NEURAL_VOICE
  return neuralVoiceOf(voiceURI)
}

/** Starts fetching a sentence ahead of time, so playing it next has no gap. */
export function prefetchSpeech(text: string, voiceURI: string | undefined) {
  const voice = neuralChoice(voiceURI)
  if (voice && neural) void neural(text, voice).catch(() => undefined)
}

// One element for every clip: iOS lets an element that has played after a tap play again
// without one, so later sentences in a lesson aren't refused.
let audioEl: HTMLAudioElement | null = null
let stopCurrent: (() => void) | null = null

/** Plays a clip to the end. Rejects if the browser won't play it, so the caller can use the device voice. */
function playBlob(blob: Blob, rate: number, signal?: AbortSignal): Promise<void> {
  stopCurrent?.()
  if (ttsSupported()) speechSynthesis.cancel()
  const el = (audioEl ??= new Audio())
  const url = URL.createObjectURL(blob)
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const settle = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      el.onended = el.onerror = el.onloadedmetadata = null
      if (stopCurrent === stop) stopCurrent = null
      URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve()
    }
    // Stopped by the caller, or by the next clip starting: this one is over.
    const stop = () => {
      el.pause()
      settle()
    }
    stopCurrent = stop
    signal?.addEventListener('abort', stop, { once: true })
    el.onended = () => settle()
    el.onerror = () => settle(new Error('audio could not be played'))
    // Safety net: some browsers never fire `ended` for a clip interrupted by the OS.
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) timer = setTimeout(stop, (el.duration * 1000) / rate + 2000)
    }
    el.src = url
    el.preservesPitch = true
    el.playbackRate = rate
    el.defaultPlaybackRate = rate
    // Refused (autoplay rules) or undecodable: let the device voice say it instead.
    el.play().catch((e: unknown) => settle(signal?.aborted || settled ? undefined : e))
  })
}

export async function speak(text: string, rate = 1, voiceURI?: string, signal?: AbortSignal): Promise<void> {
  const voice = neuralChoice(voiceURI)
  if (voice && neural) {
    try {
      const blob = await neural(text, voice, signal)
      if (signal?.aborted) return
      return await playBlob(blob, rate, signal)
    } catch {
      if (signal?.aborted) return
      // Offline with nothing cached, the server's quota used up, or the browser refused the clip:
      // the device voice takes over.
    }
  }
  return speakOnDevice(text, rate, voice ? undefined : voiceURI, signal)
}

async function speakOnDevice(text: string, rate: number, voiceURI: string | undefined, signal?: AbortSignal): Promise<void> {
  // No voice: wait roughly as long as speaking would take, so pacing still works.
  const fallback = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, fake() ? 50 : estimateSpeechMs(text, rate))
      signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
    })
  if (fake() || !ttsSupported()) return fallback()
  const voices = await japaneseVoices()
  if (signal?.aborted) return
  if (!voices.length) return fallback()
  stopCurrent?.()
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  u.rate = rate
  u.voice = voices.find((v) => v.voiceURI === voiceURI) ?? voices[0]
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, estimateSpeechMs(text, rate) * 2 + 2000)
    const finish = () => (clearTimeout(timer), resolve())
    u.onend = finish
    u.onerror = finish
    signal?.addEventListener('abort', () => (speechSynthesis.cancel(), finish()), { once: true })
    speechSynthesis.speak(u)
  })
}
