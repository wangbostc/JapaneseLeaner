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

  const url = URL.createObjectURL(media)
  const audio = new Audio(url)
  audio.preservesPitch = true

  const segment = (start: number, end: number | null, rate: number, signal: AbortSignal, onTime?: (t: number) => void) =>
    new Promise<void>((resolve) => {
      const done = () => {
        audio.pause()
        audio.removeEventListener('timeupdate', tick)
        audio.removeEventListener('ended', done)
        resolve()
      }
      const tick = () => {
        onTime?.(audio.currentTime)
        if (end !== null && audio.currentTime >= end) done()
      }
      audio.addEventListener('timeupdate', tick)
      audio.addEventListener('ended', done)
      signal.addEventListener('abort', done, { once: true })
      audio.currentTime = start
      audio.playbackRate = rate
      audio.play().catch(done)
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
      audio.pause()
      URL.revokeObjectURL(url)
    },
  }
}
