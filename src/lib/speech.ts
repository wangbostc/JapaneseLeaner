/**
 * Browser speech I/O behind small seams. Everything is feature-detected:
 * Firefox has no SpeechRecognition, Chrome's needs a network, Safari's is
 * prefixed, and a device may have no Japanese TTS voice at all.
 *
 * `window.__kikitoriFake` replaces recognition and TTS for end-to-end tests,
 * where there is no microphone and no voice.
 */

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

/** Japanese voices; the list fills in asynchronously on most browsers. */
export function japaneseVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([])
  voicesReady ??= new Promise((resolve) => {
    const pick = () => speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('ja'))
    if (speechSynthesis.getVoices().length) return resolve(pick())
    const timer = setTimeout(() => resolve(pick()), 1500)
    speechSynthesis.addEventListener('voiceschanged', () => (clearTimeout(timer), resolve(pick())), { once: true })
  })
  return voicesReady
}

/** Rough spoken duration, used as a safety net when TTS never fires `end`. */
export const estimateSpeechMs = (text: string, rate: number) => (text.length * 160) / rate + 600

export async function speak(text: string, rate = 1, voiceURI?: string, signal?: AbortSignal): Promise<void> {
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
