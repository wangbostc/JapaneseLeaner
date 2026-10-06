import type { Helper, HelperEvent } from './helper'

/** What a spoken attempt produced. */
export interface Heard {
  /** Everything recognised; '' when nothing was (or recognition isn't available). */
  text: string
  /** The attempt's recording, for playback; null if there is none. */
  recording: string | null
  /** Why recognition produced nothing, when it said (often just silence). */
  error?: string
}

export interface Listening {
  /** Resolves once the microphone is live: the moment to say "speak now". */
  started: Promise<void>
  /** Ends the attempt: what was heard, and the recording. */
  stop(): Promise<Heard>
  /** Ends it, discarding the result. */
  cancel(): void
}

export interface AudioStatus {
  /** Speech recognition is allowed and available: attempts can be scored. */
  canScore: boolean
  /** Recognition runs on this Mac (Japanese dictation installed), not on Apple's servers. */
  onDevice: boolean
}

/** Sound in and out, for the study steps. */
export interface Audio {
  status(): Promise<AudioStatus>
  /** Reads Japanese text aloud; resolves when done or stopped. */
  speak(text: string, rate: number, signal?: AbortSignal): Promise<void>
  /** Plays from `start` to `end` (seconds; null: to the end) of an audio file. */
  playFile(path: string, start: number, end: number | null, rate: number, signal?: AbortSignal, onTime?: (t: number) => void): Promise<void>
  /** Opens the microphone: recognises live while recording, so nothing said early is lost. */
  listen(onInterim: (text: string) => void): Listening
}

/** Stops call `id` when `signal` aborts. */
function stopOnAbort(helper: Helper, id: number, signal?: AbortSignal) {
  if (!signal) return () => {}
  const stop = () => void helper.call('stop', { target: id }).result.catch(() => {})
  if (signal.aborted) stop()
  signal.addEventListener('abort', stop, { once: true })
  return () => signal.removeEventListener('abort', stop)
}

/**
 * The Audio interface over the Swift helper. Recordings go to `recordingPath()` (one file per
 * attempt, in the app's cache).
 */
export function helperAudio(helper: Helper, recordingPath: () => string): Audio {
  return {
    async status() {
      const r = await helper.call('status').result
      // Not asked yet counts: the first attempt asks. Only a refusal turns scoring off.
      return { canScore: r.speech !== 'denied' && r.speech !== 'restricted' && r.recognizer === true, onDevice: r.onDevice === true }
    },
    async speak(text, rate, signal) {
      if (signal?.aborted) return
      const call = helper.call('speak', { text, rate })
      const release = stopOnAbort(helper, call.id, signal)
      try {
        await call.result
      } finally {
        release()
      }
    },
    async playFile(path, start, end, rate, signal, onTime) {
      if (signal?.aborted) return
      const call = helper.call('play', { path, start, end, rate, ticks: Boolean(onTime) }, (e) => e.event === 'time' && onTime?.(e.t as number))
      const release = stopOnAbort(helper, call.id, signal)
      try {
        await call.result
      } finally {
        release()
      }
    },
    listen(onInterim) {
      let markStarted: () => void = () => {}
      let failStart: (e: Error) => void = () => {}
      const started = new Promise<void>((resolve, reject) => {
        markStarted = resolve
        failStart = reject
      })
      const onEvent = (e: HelperEvent) => {
        if (e.event === 'listening') markStarted()
        if (e.event === 'interim') onInterim(e.text as string)
      }
      const call = helper.call('listen', { path: recordingPath() }, onEvent)
      // A listen that fails before the mic opens (denied, no input device) fails `started`.
      call.result.then(markStarted, failStart)
      let ended = false
      return {
        started,
        async stop() {
          if (!ended) {
            ended = true
            await helper.call('finish', { target: call.id }).result.catch(() => {})
          }
          const r = await call.result
          return { text: (r.text as string) ?? '', recording: (r.recording as string) ?? null, ...(r.recognitionError ? { error: r.recognitionError as string } : {}) }
        },
        cancel() {
          if (ended) return
          ended = true
          void helper.call('stop', { target: call.id }).result.catch(() => {})
          call.result.catch(() => {})
        },
      }
    },
  }
}

/**
 * A stand-in for tests and dev runs: speaking and playing finish on the next tick, and each
 * attempt "hears" the next scripted transcript.
 */
export function fakeAudio(transcripts: string[] = [], status: AudioStatus = { canScore: true, onDevice: true }): Audio & { spoken: string[] } {
  const spoken: string[] = []
  const tick = () => new Promise<void>((r) => setTimeout(r, 0))
  return {
    spoken,
    status: async () => status,
    async speak(text, _rate, signal) {
      if (!signal?.aborted) spoken.push(text)
      await tick()
    },
    async playFile(_path, start, end, _rate, signal, onTime) {
      if (signal?.aborted) return
      onTime?.(start)
      if (end !== null) onTime?.(end)
      await tick()
    },
    listen(onInterim) {
      const text = transcripts.shift() ?? ''
      if (text) onInterim(text.slice(0, Math.ceil(text.length / 2)))
      return { started: Promise.resolve(), stop: async () => ({ text: status.canScore ? text : '', recording: null }), cancel() {} }
    },
  }
}
