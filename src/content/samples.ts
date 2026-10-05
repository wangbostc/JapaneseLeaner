import type { Sentence } from '../lib/db'
import samples from './samples.json'

/**
 * Starter lessons, written for this app and voiced by the device's Japanese TTS. They are kept
 * in MongoDB; samples.json is the committed export (scripts/lessons.mjs).
 */
interface Sample {
  title: string
  level: string
  lines: { ja: string; en: string; zh: string }[]
}

export const sampleLessons = () =>
  (samples as Sample[]).map((s) => ({
    title: s.title,
    level: s.level,
    builtIn: true,
    sentences: s.lines.map(({ ja, en, zh }): Sentence => ({ start: null, end: null, text: ja, translations: { en, zh } })),
  }))
