import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_ENGINE_URLS, probeEngines, synthesize } from '@kikitori/core/engines'
import { engineOf, styleOf, type EngineKind, type EngineVoice, type EngineVoiceId } from '@kikitori/core/voices'
import type { Audio } from './audio'

/** AivisSpeech and VOICEVOX on this Mac: their voices, and sentences made in them as files. */
export interface EngineVoices {
  /** Where each engine is expected. */
  urls: Record<EngineKind, string>
  /** Each engine's voices (AivisSpeech first), and which engines answered. */
  probe(): Promise<{ voices: EngineVoice[]; up: EngineKind[] }>
  /** The WAV file of `text` in `voice` if it was made before (and marks it used), else null. */
  made(voice: EngineVoiceId, text: string): Promise<string | null>
  /** The WAV file of `text` in `voice`, made by its engine the first time; rejects if it can't be. */
  clip(voice: EngineVoiceId, text: string, signal?: AbortSignal): Promise<string>
  /** Deletes a clip that wouldn't play, so it's made again next time. */
  discard(path: string): Promise<void>
}

/** The clip cache's size once pruned: around ten hours of speech (24 kHz, 16-bit mono). */
const MAX_CACHE_BYTES = 1_500_000_000

/**
 * Clips are kept in `dir`, named by voice and text, so a sentence is made once per voice and
 * replays work with the engine closed. A clip's file time is its last use: `prune` drops the
 * least recently used beyond `maxBytes`.
 */
export function engineVoices(dir: string, { urls = DEFAULT_ENGINE_URLS, fetch }: { urls?: Record<EngineKind, string>; fetch?: typeof globalThis.fetch } = {}) {
  let written = 0
  const pathOf = (voice: EngineVoiceId, text: string) =>
    join(dir, `${engineOf(voice)}-${styleOf(voice)}-${createHash('sha256').update(text).digest('hex').slice(0, 32)}.wav`)
  const voices: EngineVoices = {
    urls,
    probe: () => probeEngines(urls, fetch),
    async made(voice, text) {
      const path = pathOf(voice, text)
      const now = new Date()
      try {
        await utimes(path, now, now)
        return path
      } catch {
        return null // not made yet
      }
    },
    async clip(voice, text, signal) {
      const made = await voices.made(voice, text)
      if (made) return made
      const path = pathOf(voice, text)
      const blob = await synthesize(urls[engineOf(voice)], voice, text, signal, fetch)
      await mkdir(dir, { recursive: true })
      // Written whole, then renamed: a clip is never seen half-written.
      const partial = `${path}.${process.pid}-${++written}.part`
      await writeFile(partial, new Uint8Array(await blob.arrayBuffer()))
      await rename(partial, path)
      return path
    },
    discard: (path) => rm(path, { force: true }).catch(() => {}),
  }
  const prune = async (maxBytes = MAX_CACHE_BYTES) => {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return // nothing made yet
    }
    // A file that can't be read or removed is left alone: pruning never stops the app starting.
    const files = await Promise.all(
      names.map(async (name) => {
        const path = join(dir, name)
        return stat(path).then(
          ({ size, mtimeMs }) => ({ path, name, size, mtimeMs }),
          () => null,
        )
      }),
    )
    let total = 0
    for (const f of files.filter((f) => f !== null).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      total += f.size
      // A leftover .part is from a run that quit mid-write.
      if (total > maxBytes || f.name.endsWith('.part')) await voices.discard(f.path)
    }
  }
  return { ...voices, prune }
}

/** After an engine fails, clips it hasn't made yet aren't asked of it for this long. */
const RETRY_AFTER_MS = 30_000

/** Audio that speaks in an engine voice, once one is set. */
export interface VoicedAudio extends Audio {
  /** The engine voice to speak in from the next sentence on; undefined: the Mac's own. */
  setVoice(voice: EngineVoiceId | undefined): void
}

/**
 * `base` speaking in the engine voice last set (read at each sentence, so a change in Settings
 * applies at once): each sentence is made into a clip and played at the learner's rate. A clip
 * made before always plays, engine or not; one its engine can't make (or one that won't play)
 * is read in the Mac's own voice.
 *
 * Each clip plays on its own (the Mac's voice queued its sentences), and one can take a while to
 * make: so a new sentence, from a play button or a study step, stops the last one rather than
 * playing over it or after it.
 */
export function withEngineVoice(base: Audio, voices: EngineVoices, now = Date.now): VoicedAudio {
  let voice: EngineVoiceId | undefined
  let miss: { voice: EngineVoiceId; until: number } | null = null
  let current = new AbortController()

  /** The sentence's clip, made now unless its engine failed a moment ago; null if there is none. */
  const clipOf = async (v: EngineVoiceId, text: string, signal: AbortSignal) => {
    try {
      const made = await voices.made(v, text)
      if (made || (miss?.voice === v && now() < miss.until)) return made
      const path = await voices.clip(v, text, signal)
      miss = null
      return path
    } catch {
      if (!signal.aborted) miss = { voice: v, until: now() + RETRY_AFTER_MS }
      return null
    }
  }

  return {
    ...base,
    setVoice(v) {
      voice = v
    },
    async speak(text, rate, signal) {
      current.abort()
      const mine = (current = new AbortController())
      const stop = signal ? AbortSignal.any([signal, mine.signal]) : mine.signal
      const path = voice && !stop.aborted ? await clipOf(voice, text, stop) : null
      // Stopped while the clip was being made: say nothing, late.
      if (stop.aborted) return
      if (!path) return base.speak(text, rate, stop)
      try {
        await base.playFile(path, 0, null, rate, stop)
      } catch {
        if (stop.aborted) return
        await voices.discard(path)
        return base.speak(text, rate, stop)
      }
    },
  }
}
