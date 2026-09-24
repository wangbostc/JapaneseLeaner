import { STRINGS } from './i18n'
import type { Settings } from './useSettings'

/**
 * Keeps only known settings with valid values. Settings come from
 * localStorage and from restored backups, and one bad value (an unknown UI
 * language) would otherwise leave the app unable to render, reload after reload.
 */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const out: Partial<Settings> = {}
  if (typeof raw.lang === 'string' && Object.hasOwn(STRINGS, raw.lang)) out.lang = raw.lang as Settings['lang']
  if (typeof raw.furigana === 'boolean') out.furigana = raw.furigana
  if (typeof raw.translation === 'boolean') out.translation = raw.translation
  if (typeof raw.rate === 'number' && Number.isFinite(raw.rate)) out.rate = Math.min(2, Math.max(0.5, raw.rate))
  if (typeof raw.voiceURI === 'string') out.voiceURI = raw.voiceURI
  return out
}
