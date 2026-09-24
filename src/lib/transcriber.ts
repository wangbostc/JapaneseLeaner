import type { WorkerMessage, WorkerRequest } from '../workers/transcribe.worker'
import { pickAsyncifyBuild } from './ortBuild'
import { chunksToCues, cuesToSrt, decodeTo16kMono, TranscribeError, type AsrChunk, type WhisperModelId } from './transcribe'

export type TranscribeProgress = { phase: 'decoding' } | { phase: 'downloading'; fraction: number } | { phase: 'transcribing' }

declare global {
  interface Window {
    /** e2e seam: returns Whisper-shaped chunks instead of running a real model. */
    __kikitoriFakeAsr?: () => AsrChunk[]
  }
}

/**
 * Transcribes Japanese audio to SRT text (one cue per sentence), downloading the model on first use.
 * Each run gets its own worker, terminated when it finishes, fails or is aborted, so runs can't
 * cross wires and a worker that failed to load isn't reused. The model itself stays in
 * transformers.js's cache, so a new worker doesn't download it again.
 */
export async function transcribeToSrt(
  file: Blob,
  model: WhisperModelId,
  onProgress: (p: TranscribeProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  onProgress({ phase: 'decoding' })
  const { samples, duration } = await decodeTo16kMono(file)
  signal?.throwIfAborted()
  if (window.__kikitoriFakeAsr) return cuesToSrt(chunksToCues(window.__kikitoriFakeAsr(), duration))

  const worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' })
  try {
    const chunks = await new Promise<AsrChunk[]>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data
        if (m.type === 'progress') onProgress({ phase: 'downloading', fraction: m.total ? m.loaded / m.total : 0 })
        else if (m.type === 'transcribing') onProgress({ phase: 'transcribing' })
        else if (m.type === 'done') resolve(m.chunks)
        else reject(new TranscribeError('failed', m.message))
      }
      worker.onerror = (e) => reject(new TranscribeError('failed', e.message || 'transcription worker failed'))
      const request: WorkerRequest = { samples, model, asyncify: pickAsyncifyBuild(navigator) }
      worker.postMessage(request, [samples.buffer])
    })
    return cuesToSrt(chunksToCues(chunks, duration))
  } finally {
    worker.terminate()
  }
}
