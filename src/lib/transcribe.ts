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

/** Decodes any audio the browser can play into 16 kHz mono samples, as Whisper expects. */
export async function decodeTo16kMono(file: Blob): Promise<{ samples: Float32Array; duration: number }> {
  const bytes = await file.arrayBuffer()
  const decoded = await new AudioContext().decodeAudioData(bytes)
  const frames = Math.ceil(decoded.duration * 16000)
  const offline = new OfflineAudioContext(1, frames, 16000)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return { samples: rendered.getChannelData(0), duration: decoded.duration }
}
