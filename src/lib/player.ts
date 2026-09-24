import type { Sentence } from './db'
import { speak } from './speech'

/** Plays a lesson's sentences from its audio file, or with TTS when it has none. */
export interface Player {
  play(sentence: Sentence, rate: number): Promise<void>
  playAll(sentences: Sentence[], rate: number, onSentence?: (index: number) => void): Promise<void>
  stop(): void
  dispose(): void
}

export function createPlayer(media: Blob | null, voiceURI?: string): Player {
  let abort = new AbortController()
  const fresh = () => {
    abort.abort()
    abort = new AbortController()
    return abort.signal
  }

  if (!media) {
    return {
      play: (s, rate) => speak(s.text, rate, voiceURI, fresh()),
      async playAll(sentences, rate, onSentence) {
        const signal = fresh()
        for (let i = 0; i < sentences.length && !signal.aborted; i++) {
          onSentence?.(i)
          await speak(sentences[i].text, rate, voiceURI, signal)
        }
      },
      stop: () => fresh(),
      dispose: () => abort.abort(),
    }
  }

  // Created lazily and torn down on dispose, so a disposed player (React
  // StrictMode runs effect cleanups once in dev) still works if reused.
  let audio: HTMLAudioElement | null = null
  let url: string | null = null
  const ensureAudio = () => {
    if (!audio) {
      url = URL.createObjectURL(media)
      audio = new Audio(url)
      audio.preservesPitch = true
    }
    return audio
  }

  const segment = (start: number, end: number | null, rate: number, signal: AbortSignal, onTime?: (t: number) => void) =>
    new Promise<void>((resolve) => {
      const el = ensureAudio()
      let settled = false
      let frame = 0
      const done = () => {
        if (settled) return
        settled = true
        cancelAnimationFrame(frame)
        el.pause()
        el.removeEventListener('timeupdate', tick)
        el.removeEventListener('ended', done)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const tick = () => {
        onTime?.(el.currentTime)
        if (end !== null && el.currentTime >= end) done()
      }
      // timeupdate fires only every ~250 ms; checking each frame stops within
      // a frame of the cue end instead of bleeding into the next sentence.
      const poll = () => {
        tick()
        if (!settled) frame = requestAnimationFrame(poll)
      }
      el.addEventListener('timeupdate', tick)
      el.addEventListener('ended', done)
      signal.addEventListener('abort', done, { once: true })
      el.currentTime = start
      el.playbackRate = rate
      el.play().then(poll, done)
    })

  return {
    play: (s, rate) => segment(s.start ?? 0, s.end, rate, fresh()),
    playAll(sentences, rate, onSentence) {
      if (!sentences.length) return Promise.resolve()
      const first = sentences[0].start ?? 0
      const last = sentences.at(-1)!.end
      return segment(first, last, rate, fresh(), (t) => {
        const i = sentences.findLastIndex((s) => (s.start ?? 0) <= t)
        if (i >= 0) onSentence?.(i)
      })
    },
    stop: () => fresh(),
    dispose: () => {
      abort.abort()
      audio?.pause()
      audio = null
      if (url) URL.revokeObjectURL(url)
      url = null
    },
  }
}
