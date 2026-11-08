import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { loadPlace, partOf, savePlace, shelvesOf, type Shelf, type ShelfKey } from '@kikitori/core/library'
import { useSettings } from '../app/useSettings'
import { prefs } from '../app/privateLessons'
import { loadChapters, saveChapter } from '../app/libraryPlace'
import { Icon } from '../components/Icon'
import { LessonRow } from '../components/LessonRow'
import { db } from '../lib/db'

/**
 * Shelves: one per textbook (a private lesson's "<book> · L<n>" label), the starter lessons, and
 * the learner's own. A book is shown a chapter at a time, so a phone never scrolls through all of it.
 * With no textbook there's a single list, as before.
 */
export function Library() {
  const { t } = useSettings()
  const lessons = useLiveQuery(() => db.lessons.toArray(), [])
  // Shelves only once there's a textbook: without one, every lesson in one list, newest first.
  const shelves = useMemo((): Shelf[] => {
    if (!lessons) return []
    const all = shelvesOf(lessons)
    if (all.some((s) => s.key.startsWith('book:'))) return all
    return [{ key: 'mine', book: '', lessons: [...lessons].sort((a, b) => b.createdAt - a.createdAt || b.id! - a.id!) }]
  }, [lessons])
  const [now] = useState(() => Date.now())
  const [place, setPlace] = useState(() => loadPlace(prefs).shelf)
  const [chapters, setChapters] = useState(loadChapters)

  // A shelf that's gone (its lessons deleted): the first.
  const shelf = shelves.find((s) => s.key === place) ?? shelves[0]
  const isBook = !!shelf?.key.startsWith('book:')
  const headings = useMemo(() => (isBook && shelf ? [...new Set(shelf.lessons.map((l) => partOf(l.level!).heading))] : []), [isBook, shelf])
  const chapter = shelf && headings.includes(chapters[shelf.key]) ? chapters[shelf.key] : headings[0]
  const shown = !shelf ? [] : isBook ? shelf.lessons.filter((l) => partOf(l.level!).heading === chapter) : shelf.lessons

  const openShelf = (key: ShelfKey) => {
    setPlace(key)
    savePlace(prefs, { shelf: key, page: 0 })
  }
  const openChapter = (heading: string) => setChapters(saveChapter(shelf!.key, heading))
  // The open shelf and chapter in view (a later chapter can be off to the right on a phone).
  const tabs = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tabs.current?.querySelectorAll<HTMLElement>('[aria-selected="true"]').forEach((el) => el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }))
  }, [shelf?.key, chapter])
  const name = (s: Shelf) => (s.key === 'starters' ? t.shelfStarters : s.key === 'mine' ? t.shelfMine : s.book)

  return (
    <div className="page" ref={tabs}>
      <div className="page-head">
        <h1>{t.navLibrary}</h1>
        <Link to="/import" className="btn primary">
          <Icon name="plus" /> {t.importLesson}
        </Link>
      </div>
      {shelves.length > 1 && (
        <div className="shelf-tabs" role="tablist" aria-label={t.navLibrary}>
          {shelves.map((s) => (
            <button key={s.key} role="tab" aria-selected={s.key === shelf?.key} className="btn" onClick={() => openShelf(s.key)}>
              {name(s)} <span className="shelf-count">{s.lessons.length}</span>
            </button>
          ))}
        </div>
      )}
      {headings.length > 1 && (
        <div className="chapter-tabs" role="tablist" aria-label={shelf!.book}>
          {headings.map((h) => (
            <button key={h} role="tab" aria-selected={h === chapter} className="btn" lang="ja" onClick={() => openChapter(h)}>
              {h || shelf!.book}
            </button>
          ))}
        </div>
      )}
      {shelf && <p className="muted small shelf-summary">{t.lessonCount(shown.length)}</p>}
      <div className="list">
        {shown.map((l) => (
          <LessonRow key={l.id} lesson={l} now={now} />
        ))}
      </div>
    </div>
  )
}
