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
  /** A WAV file of `text` in `voice`, made by its engine the first time; rejects if it can't be. */
  clip(voice: EngineVoiceId, text: string, signal?: AbortSignal): Promise<string>
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
  const voices: EngineVoices = {
    urls,
    probe: () => probeEngines(urls, fetch),
    async clip(voice, text, signal) {
      const hash = createHash('sha256').update(text).digest('hex').slice(0, 32)
      const path = join(dir, `${engineOf(voice)}-${styleOf(voice)}-${hash}.wav`)
      const now = new Date()
      try {
        await utimes(path, now, now)
        return path
      } catch {
        // not made yet
      }
      const blob = await synthesize(urls[engineOf(voice)], voice, text, signal, fetch)
      await mkdir(dir, { recursive: true })
      // Written whole, then renamed: a clip is never seen half-written.
      const partial = `${path}.${process.pid}-${++written}.part`
      await writeFile(partial, new Uint8Array(await blob.arrayBuffer()))
      await rename(partial, path)
      return path
    },
  }
  const prune = async (maxBytes = MAX_CACHE_BYTES) => {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return // nothing made yet
    }
    const files = await Promise.all(names.map(async (name) => ({ path: join(dir, name), name, ...(await stat(join(dir, name))) })))
    let total = 0
    for (const f of files.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      total += f.size
      // A leftover .part is from a run that quit mid-write.
      if (total > maxBytes || f.name.endsWith('.part')) await rm(f.path, { force: true })
    }
  }
  return { ...voices, prune }
}

/** After an engine fails, the Mac's own voice speaks for this long before the engine is tried again. */
const RETRY_AFTER_MS = 30_000

/** Audio that speaks in an engine voice, once one is set. */
export interface VoicedAudio extends Audio {
  /** The engine voice to speak in from the next sentence on; undefined: the Mac's own. */
  setVoice(voice: EngineVoiceId | undefined): void
}

/**
 * `base` speaking in the engine voice last set (read at each sentence, so a change in Settings
 * applies at once): each sentence is made into a clip and played at the learner's rate. Without a
 * voice, or when its engine can't make the clip, the Mac's own voice speaks.
 *
 * A clip can take a while to make, and each plays on its own: so a sentence spoken without a
 * signal (a card's or a word's play button) stops the last one, rather than playing over it or
 * after it.
 */
export function withEngineVoice(base: Audio, voices: EngineVoices, now = Date.now): VoicedAudio {
  let voice: EngineVoiceId | undefined
  let miss: { voice: EngineVoiceId; until: number } | null = null
  let lone = new AbortController()
  return {
    ...base,
    setVoice(v) {
      voice = v
    },
    async speak(text, rate, signal) {
      if (!signal) {
        lone.abort()
        lone = new AbortController()
        signal = lone.signal
      }
      const v = voice
      if (v && !(miss?.voice === v && now() < miss.until) && !signal?.aborted) {
        let path: string
        try {
          path = await voices.clip(v, text, signal)
          miss = null
        } catch {
          if (signal?.aborted) return
          miss = { voice: v, until: now() + RETRY_AFTER_MS }
          return base.speak(text, rate, signal)
        }
        // Stopped while the clip was being made: say nothing, late.
        if (signal?.aborted) return
        return base.playFile(path, 0, null, rate, signal)
      }
      return base.speak(text, rate, signal)
    },
  }
}
