import type { Lesson } from '@kikitori/core/model'
import type { KeyValueStore } from '@kikitori/core/seed'

/**
 * The library's shelves: one per textbook, the starter lessons, and the learner's own.
 *
 * A textbook is a lesson level "<book> · <chapter>" (private lessons are labelled so: "Genki II ·
 * L13", "Genki II · L13 読み書き"); its lessons are in the book's order: by lesson number, the
 * dialogues before the readings, then as added (a chapter's documents are added in book order).
 * The starters go N5 to N1. The learner's own lessons are newest first.
 */
export type ShelfKey = `book:${string}` | 'starters' | 'mine'

export interface Shelf {
  key: ShelfKey
  /** The book's name; empty for the starters and the learner's own (the screen names those). */
  book: string
  lessons: Lesson[]
}

const SEP = ' · '
const bookOf = (l: Lesson) => (l.level?.includes(SEP) ? l.level.slice(0, l.level.indexOf(SEP)).trim() : null)

/** Within a book: "L13 読み書き" -> { chapter: 13, reading: true }; a part with no number ("あいさつ") comes first. */
export function partOf(level: string) {
  const part = level.slice(level.indexOf(SEP) + SEP.length)
  const n = /^L(\d+)/.exec(part)
  return { chapter: n ? Number(n[1]) : -1, reading: /読み書き$/.test(part), heading: part.replace(/\s*読み書き$/, '') }
}

const inBook = (a: Lesson, b: Lesson) => {
  const pa = partOf(a.level!)
  const pb = partOf(b.level!)
  return pa.chapter - pb.chapter || Number(pa.reading) - Number(pb.reading) || a.createdAt - b.createdAt || a.id! - b.id!
}
const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1']
const rank = (l: Lesson) => (JLPT.includes(l.level ?? '') ? JLPT.indexOf(l.level!) : JLPT.length)
const starters = (a: Lesson, b: Lesson) => rank(a) - rank(b) || a.createdAt - b.createdAt || a.id! - b.id!
const newest = (a: Lesson, b: Lesson) => b.createdAt - a.createdAt || b.id! - a.id!

/** The shelves that have lessons: the textbooks by name (Genki I before Genki II), then the starters, then the learner's own. */
export function shelvesOf(lessons: Lesson[]): Shelf[] {
  const books = new Map<string, Lesson[]>()
  const builtIn: Lesson[] = []
  const mine: Lesson[] = []
  for (const l of lessons) {
    const book = bookOf(l)
    if (book) books.set(book, [...(books.get(book) ?? []), l])
    else if (l.builtIn) builtIn.push(l)
    else mine.push(l)
  }
  const shelves: Shelf[] = [...books]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([book, ls]) => ({ key: `book:${book}` as const, book, lessons: ls.sort(inBook) }))
  if (builtIn.length) shelves.push({ key: 'starters', book: '', lessons: builtIn.sort(starters) })
  if (mine.length) shelves.push({ key: 'mine', book: '', lessons: mine.sort(newest) })
  return shelves
}

export const PAGE_SIZE = 20

export const pageCount = (n: number) => Math.max(1, Math.ceil(n / PAGE_SIZE))

/** Where the learner was in the library, kept so coming back from a lesson returns there. */
export interface Place {
  shelf: ShelfKey | null
  page: number
}
const PLACE = 'kikitori.libraryPlace'

export function loadPlace(prefs: KeyValueStore): Place {
  try {
    const p = JSON.parse(prefs.getItem(PLACE) ?? 'null')
    if (p && typeof p.page === 'number') return { shelf: typeof p.shelf === 'string' ? p.shelf : null, page: p.page }
  } catch {
    // A broken value: start at the first shelf.
  }
  return { shelf: null, page: 0 }
}

export const savePlace = (prefs: KeyValueStore, place: Place) => prefs.setItem(PLACE, JSON.stringify(place))
