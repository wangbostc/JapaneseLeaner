import { partOf, placeOf, savePlace, type ShelfKey } from '@kikitori/core/library'
import type { Lesson } from '@kikitori/core/model'
import { prefs } from './privateLessons'

/** The chapter last open on each book's shelf, so coming back from a lesson returns to it. */
const CHAPTERS = 'kikitori.libraryChapters'

export function loadChapters(): Record<string, string> {
  try {
    const v = JSON.parse(prefs.getItem(CHAPTERS) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function saveChapter(shelf: ShelfKey, heading: string): Record<string, string> {
  const next = { ...loadChapters(), [shelf]: heading }
  prefs.setItem(CHAPTERS, JSON.stringify(next))
  return next
}

/** Opens the library where a lesson is (its shelf, and its chapter in a book): after an import. */
export function rememberLesson(lessons: Lesson[], id: number) {
  const place = placeOf(lessons, id)
  if (!place.shelf) return
  savePlace(prefs, place)
  const lesson = lessons.find((l) => l.id === id)
  if (place.shelf.startsWith('book:') && lesson?.level) saveChapter(place.shelf, partOf(lesson.level).heading)
}
