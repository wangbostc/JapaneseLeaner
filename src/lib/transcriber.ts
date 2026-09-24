import type { WorkerMessage } from '../workers/transcribe.worker'
import { chunksToCues, cuesToSrt, decodeTo16kMono, type AsrChunk, type WhisperModelId } from './transcribe'

export type TranscribeProgress = { phase: 'decoding' } | { phase: 'downloading'; fraction: number } | { phase: 'transcribing' }

declare global {
  interface Window {
    /** e2e seam: returns Whisper-shaped chunks instead of running a real model. */
    __kikitoriFakeAsr?: () => AsrChunk[]
  }
}

let worker: Worker | null = null

/** Transcribes Japanese audio to SRT text (one cue per sentence), downloading the model on first use. */
export async function transcribeToSrt(file: Blob, model: WhisperModelId, onProgress: (p: TranscribeProgress) => void): Promise<string> {
  onProgress({ phase: 'decoding' })
  const { samples, duration } = await decodeTo16kMono(file)
  if (window.__kikitoriFakeAsr) return cuesToSrt(chunksToCues(window.__kikitoriFakeAsr(), duration))

  worker ??= new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const chunks = await new Promise<AsrChunk[]>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data
      if (m.type === 'progress') onProgress({ phase: 'downloading', fraction: m.total ? m.loaded / m.total : 0 })
      else if (m.type === 'transcribing') onProgress({ phase: 'transcribing' })
      else if (m.type === 'done') resolve(m.chunks)
      else reject(new Error(m.message))
    }
    w.onerror = (e) => reject(new Error(e.message || 'transcription worker failed'))
    w.postMessage({ samples, model }, [samples.buffer])
  })
  return cuesToSrt(chunksToCues(chunks, duration))
}
