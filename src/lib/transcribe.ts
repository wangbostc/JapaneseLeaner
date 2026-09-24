import type { Cue } from './subtitles'
import { splitSentences } from './subtitles'

/** Whisper models offered for transcription, smallest first. Sizes are the q8 download. */
export const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-base', label: 'Base', sizeMb: 80 },
  { id: 'onnx-community/whisper-small', label: 'Small', sizeMb: 250 },
] as const

export type WhisperModelId = (typeof WHISPER_MODELS)[number]['id']

/** One timed piece of Whisper output: [start, end] in seconds (end may be null at the tail). */
export interface AsrChunk {
  timestamp: [number, number | null]
  text: string
}

/**
 * Turns Whisper chunks into one cue per sentence. A chunk often holds several
 * sentences; its time span is shared out in proportion to each sentence's
 * length, which is close enough to start practice and easy to adjust.
 */
export function chunksToCues(chunks: AsrChunk[], audioDuration: number): Cue[] {
  const cues: Cue[] = []
  chunks.forEach((chunk, i) => {
    const start = chunk.timestamp[0]
    const end = chunk.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? audioDuration
    const sentences = splitSentences(chunk.text).map((c) => c.text)
    const total = sentences.reduce((n, s) => n + s.length, 0)
    let t = start
    for (const text of sentences) {
      const span = total ? ((end - start) * text.length) / total : 0
      cues.push({ start: round(t), end: round(t + span), text })
      t += span
    }
  })
  return cues
}

const round = (n: number) => Math.round(n * 1000) / 1000

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

/** SRT text for the cues, so the Import form's editor and parser take it as-is. */
export function cuesToSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start ?? 0)} --> ${stamp(c.end ?? c.start ?? 0)}\n${c.text}\n`).join('\n')
}

/** Longest audio we transcribe in one go: decoding happens in memory, which phones can't spare for hours of audio. */
export const MAX_TRANSCRIBE_SECONDS = 20 * 60

export class TranscribeError extends Error {
  code: 'tooLong' | 'undecodable' | 'failed'
  constructor(code: TranscribeError['code'], detail: string = code) {
    super(detail)
    this.code = code
  }
}

/** Reads the duration from the file's metadata, without decoding the audio. */
export function probeDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const el = new Audio()
    el.preload = 'metadata'
    el.onloadedmetadata = () => (URL.revokeObjectURL(url), resolve(el.duration))
    el.onerror = () => (URL.revokeObjectURL(url), reject(new TranscribeError('undecodable')))
    el.src = url
  })
}

/**
 * Decodes any audio the browser can play into 16 kHz mono samples, as Whisper
 * expects. An OfflineAudioContext decodes straight to 16 kHz, so no full-rate
 * copy is held, and it needs no audio device (unlike AudioContext, of which
 * browsers allow only a few).
 */
export async function decodeTo16kMono(file: Blob): Promise<{ samples: Float32Array; duration: number }> {
  const duration = await probeDuration(file)
  if (Number.isFinite(duration) && duration > MAX_TRANSCRIBE_SECONDS) throw new TranscribeError('tooLong')
  let decoded: AudioBuffer
  try {
    decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new TranscribeError('undecodable')
  }
  if (decoded.duration > MAX_TRANSCRIBE_SECONDS) throw new TranscribeError('tooLong')
  const samples = new Float32Array(decoded.length)
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const channel = decoded.getChannelData(c)
    for (let i = 0; i < samples.length; i++) samples[i] += channel[i] / decoded.numberOfChannels
  }
  return { samples, duration: decoded.duration }
}
