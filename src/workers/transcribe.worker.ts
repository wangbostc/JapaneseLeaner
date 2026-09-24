/// <reference lib="webworker" />
// Runs Whisper off the main thread. transformers.js fetches the model from the
// Hugging Face hub once and keeps it in Cache Storage for later (and offline) use.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
// Pinned to the exact onnxruntime-web transformers.js depends on (a unit test checks), so these
// are its own files. Both builds are bundled; pickAsyncifyBuild picks one the way upstream does.
import ortAsyncifyMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortAsyncifyWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortPlainMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortPlainWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

env.allowLocalModels = false

export type WorkerRequest = {
  samples: Float32Array
  model: string
  /** Chosen on the main thread by pickAsyncifyBuild: navigator.vendor, which the Safari check needs, isn't exposed in workers. */
  asyncify: boolean
}
export type WorkerMessage =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'transcribing' }
  | { type: 'done'; chunks: { timestamp: [number, number | null]; text: string }[] }
  | { type: 'error'; message: string }

const pipelines = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()
const post = (m: WorkerMessage) => self.postMessage(m)

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { samples, model, asyncify } = e.data
  // Serve the ONNX runtime from our own origin instead of transformers.js's default CDN, so it
  // works offline once cached and doesn't depend on a third party serving a dev build.
  env.backends.onnx.wasm!.wasmPaths = asyncify ? { wasm: ortAsyncifyWasm, mjs: ortAsyncifyMjs } : { wasm: ortPlainWasm, mjs: ortPlainMjs }
  try {
    const files = new Map<string, { loaded: number; total: number }>()
    if (!pipelines.has(model)) {
      pipelines.set(
        model,
        pipeline('automatic-speech-recognition', model, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
            if (p.status !== 'progress' || !p.file) return
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
            const all = [...files.values()]
            post({ type: 'progress', loaded: all.reduce((n, f) => n + f.loaded, 0), total: all.reduce((n, f) => n + f.total, 0) })
          },
        }) as Promise<AutomaticSpeechRecognitionPipeline>,
      )
    }
    const asr = await pipelines.get(model)!
    post({ type: 'transcribing' })
    const out = await asr(samples, { language: 'japanese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 })
    const result = Array.isArray(out) ? out[0] : out
    post({ type: 'done', chunks: (result.chunks ?? [{ timestamp: [0, null], text: result.text }]) as never })
  } catch (err) {
    pipelines.delete(model)
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
