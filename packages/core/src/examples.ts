import type { DictEntry, Dictionary } from './jmdict'

/**
 * Example sentences from JMdict, which takes them from Tatoeba (sentences under CC BY 2.0 FR):
 * public/jmdict/examples.json, as written by scripts/build-jmdict.mjs. Its `examples` line up
 * with the dictionary's entries, so it's only used with the dictionary of the same release.
 */

/** [Japanese, English, the word as it appears in the sentence, Tatoeba sentence id, sense index]. */
type RawExample = [string, string, string, number, number]

export interface ExamplesData {
  release: string
  format: number
  /** Per dictionary entry: its examples, or 0 for none. */
  examples: (RawExample[] | 0)[]
}

export interface Example {
  ja: string
  en: string
  /** The word as it appears in `ja` (often conjugated: 食べて), always a part of it. */
  form: string
  /** The Japanese sentence on Tatoeba: tatoeba.org/sentences/<id>. */
  tatoebaId: number
  /** Which of the entry's senses it illustrates (0-based). */
  sense: number
}

export interface Examples {
  /** An entry's examples, best first (none for an entry without). */
  of(entry: DictEntry): Example[]
}

/** The examples for `dict`, or null when they were built from another release (or not at all). */
export function createExamples(data: ExamplesData | null, dict: Dictionary | null): Examples | null {
  if (!data || !dict?.release || data.release !== dict.release) return null
  return {
    of: (entry) => {
      const found = data.examples[entry.index]
      return found ? found.map(([ja, en, form, tatoebaId, sense]) => ({ ja, en, form, tatoebaId, sense })) : []
    },
  }
}

/** Where the example's word is in its sentence, as [start, end) character offsets. */
export function formRange(example: Pick<Example, 'ja' | 'form'>): [number, number] | null {
  const at = example.ja.indexOf(example.form)
  return at < 0 ? null : [at, at + example.form.length]
}

export const tatoebaUrl = (id: number) => `https://tatoeba.org/sentences/${id}`

/**
 * Which of `text`'s tokens (by index) cover any of `range`, to highlight the example's word: a
 * conjugated form spans the verb's token and its endings (食べ|まし|た).
 */
export function tokensIn(text: string, surfaces: string[], range: [number, number] | null): Set<number> {
  const marked = new Set<number>()
  if (!range) return marked
  let pos = 0
  surfaces.forEach((surface, i) => {
    const at = text.indexOf(surface, pos)
    const start = at < 0 ? pos : at
    pos = start + surface.length
    if (start < range[1] && pos > range[0]) marked.add(i)
  })
  return marked
}
