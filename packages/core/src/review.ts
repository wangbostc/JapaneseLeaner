import type { Dictionary } from './jmdict'
import type { Flashcard } from './model'
import { localDay } from './store'

/**
 * How a flashcard is reviewed. Every mode grades the same card (one schedule per card):
 * - read: see the Japanese, recall its meaning (as before)
 * - listen: hear it first, with the Japanese hidden until the answer
 * - recall: see the meaning (or a sentence's translation), recall the Japanese
 * - mix: one of the three per card, the same all day
 */
export const CARD_MODES = ['read', 'listen', 'recall', 'mix'] as const
export type CardModeSetting = (typeof CARD_MODES)[number]
export type CardMode = Exclude<CardModeSetting, 'mix'>
export const DEFAULT_CARD_MODE: CardModeSetting = 'read'

export const isCardModeSetting = (v: unknown): v is CardModeSetting => (CARD_MODES as readonly unknown[]).includes(v)

/** A small stable hash, so Mix gives a card the same mode all day (and after an undo). */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The mode `card` is shown in today under `setting`. */
export function modeOf(card: Pick<Flashcard, 'uid' | 'front'>, setting: CardModeSetting, now = Date.now()): CardMode {
  if (setting !== 'mix') return setting
  const modes: CardMode[] = ['read', 'listen', 'recall']
  return modes[hash(`${card.uid ?? card.front}|${localDay(now)}`) % modes.length]
}

/**
 * What a recall card asks with: a word's meanings (its dictionary entry's first senses, as the
 * answer shows them), or a sentence's translation. Null when there is none, and the card is then
 * read instead (as is a word while the dictionary is unavailable).
 */
export function recallPrompt(card: Pick<Flashcard, 'kind' | 'front' | 'reading'>, dict: Dictionary | null, translation?: string): string[] | null {
  if (card.kind === 'sentence') return translation ? [translation] : null
  const entry = dict?.lookup(card.front, card.reading)[0]
  return entry?.senses.length ? entry.senses.map((s) => s.glosses.join('; ')) : null
}

/** What a key does while reviewing cards, if anything. */
export type CardKeyAction = 'flip' | 1 | 2 | 3 | 4 | 'play' | 'undo'

/**
 * Space or Enter shows the answer, 1–4 grade it (Again, Hard, Good, Easy), R plays the card, U
 * undoes the last grade. Keys are named as either app gets them: the browser's (" ", "Enter") or
 * GPUI's ("space", "enter").
 */
export function cardKey(key: string, flipped: boolean): CardKeyAction | null {
  const k = key === ' ' ? 'space' : key.toLowerCase()
  if (k === 'space' || k === 'enter') return flipped ? null : 'flip'
  if (/^[1-4]$/.test(k)) return flipped ? (Number(k) as 1 | 2 | 3 | 4) : null
  if (k === 'r') return 'play'
  if (k === 'u') return 'undo'
  return null
}
