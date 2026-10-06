import type { Sentence } from '@kikitori/core/model'
import type { Audio } from './audio'

/** Plays a lesson's sentences from its audio file, or reads them aloud when it has none. */
export interface Player {
  play(sentence: Sentence, rate: number): Promise<void>
  playAll(sentences: Sentence[], rate: number, onSentence?: (index: number) => void): Promise<void>
  stop(): void
  dispose(): void
}

/** As the web app's player: each new play (or stop) cuts the previous one off. */
export function createPlayer(audio: Audio, mediaPath: string | null): Player {
  let abort = new AbortController()
  const fresh = () => {
    abort.abort()
    abort = new AbortController()
    return abort.signal
  }
  if (!mediaPath) {
    return {
      play: (s, rate) => audio.speak(s.text, rate, fresh()),
      async playAll(sentences, rate, onSentence) {
        const signal = fresh()
        for (let i = 0; i < sentences.length && !signal.aborted; i++) {
          onSentence?.(i)
          await audio.speak(sentences[i].text, rate, signal)
        }
      },
      stop: () => void fresh(),
      dispose: () => abort.abort(),
    }
  }
  return {
    play: (s, rate) => audio.playFile(mediaPath, s.start ?? 0, s.end, rate, fresh()),
    playAll(sentences, rate, onSentence) {
      if (!sentences.length) return Promise.resolve()
      return audio.playFile(mediaPath, sentences[0].start ?? 0, sentences.at(-1)!.end, rate, fresh(), (t) => {
        const i = sentences.findLastIndex((s) => (s.start ?? 0) <= t)
        if (i >= 0) onSentence?.(i)
      })
    },
    stop: () => void fresh(),
    dispose: () => abort.abort(),
  }
}
