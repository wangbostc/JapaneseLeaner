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

const SEP = /\s*·\s*/
/** "Genki II · L13 読み書き" -> ["Genki II", "L13 読み書き"]; a level with no "·" is just a name. */
const split = (level: string): [string, string | null] => {
  const at = SEP.exec(level)
  return at ? [level.slice(0, at.index).trim(), level.slice(at.index + at[0].length).trim()] : [level.trim(), null]
}

/** Within a book: "L13 読み書き" -> { chapter: 13, reading: true }; a part with no number ("あいさつ"), or none, comes first. */
export function partOf(level: string) {
  const part = split(level)[1] ?? ''
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
  // A book is named by its "<book> · <chapter>" levels; a lesson labelled with the book's name
  // alone (a private document with a book but no chapter) goes on that shelf too, at its front.
  const names = new Set(lessons.flatMap((l) => (l.level && split(l.level)[1] !== null ? [split(l.level)[0]] : [])))
  for (const l of lessons) {
    const name = l.level ? split(l.level)[0] : ''
    // (Not a starter: its "N3" stays a starter even if the learner has an "N3 · …" book.)
    const book = name && names.has(name) && !(l.builtIn && split(l.level!)[1] === null) ? name : null
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

/** Where a lesson is: its shelf and the page it's on (after an import, the library opens there). */
export function placeOf(lessons: Lesson[], id: number): Place {
  for (const shelf of shelvesOf(lessons)) {
    const i = shelf.lessons.findIndex((l) => l.id === id)
    if (i >= 0) return { shelf: shelf.key, page: Math.floor(i / PAGE_SIZE) }
  }
  return { shelf: null, page: 0 }
}

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
