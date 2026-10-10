import { Fragment, useMemo, useState } from 'react'
import { useApp, useQuery } from '../context'
import { loadPlace, PAGE_SIZE, pageCount, partOf, savePlace, shelvesOf, type Shelf, type ShelfKey } from '../library'
import { Choice } from '../ui/form'
import { LessonRow } from '../ui/LessonRow'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'

export function Library() {
  const { t, db, prefs, route, navigate } = useApp()
  const lessons = useQuery(() => db.lessons.all(), [])
  const shelves = useMemo(() => (lessons ? shelvesOf(lessons) : []), [lessons])
  const [now] = useState(() => Date.now())
  // Where the learner moved to (in the route, so a new page starts at its top), else where they
  // last were: back from a lesson, the library opens on the same shelf and page.
  const place = route.name === 'library' && route.page !== undefined ? { shelf: route.shelf ?? null, page: route.page } : loadPlace(prefs)
  const shelf = shelves.find((s) => s.key === place.shelf) ?? shelves[0]
  const pages = pageCount(shelf?.lessons.length ?? 0)
  const page = Math.min(Math.max(0, place.page), pages - 1)
  const move = (to: ShelfKey, p: number) => {
    savePlace(prefs, { shelf: to, page: p })
    navigate({ name: 'library', shelf: to, page: p })
  }
  const name = (s: Shelf) => (s.key === 'starters' ? t.shelfStarters : s.key === 'mine' ? t.shelfMine : s.book)
  const shown = shelf?.lessons.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? []
  // A textbook's lessons are headed by chapter ("L13"), its readings under their chapter's dialogues.
  const heading = (i: number) => {
    if (!shelf?.key.startsWith('book:')) return null
    const h = partOf(shown[i].level!).heading
    return i === 0 || partOf(shown[i - 1].level!).heading !== h ? h : null
  }

  return (
    <Col style={{ gap: 14 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text size={28} weight={700}>
          {t.navLibrary}
        </Text>
        <Button testId="import" label={`+ ${t.importLesson}`} variant="primary" onPress={() => navigate({ name: 'import' })} />
      </Row>
      {shelf && (
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          {shelves.length > 1 ? (
            <Choice testId="shelf" value={shelf.key} onChange={(k) => move(k, 0)} options={shelves.map((s): [ShelfKey, string] => [s.key, name(s)])} />
          ) : (
            <div />
          )}
          <Text testId="lesson-count" color={C.dim}>
            {t.lessonCount(shelf.lessons.length)}
          </Text>
        </Row>
      )}
      <Col testId="library" style={{ gap: 8 }}>
        {shown.map((l, i) => {
          const h = heading(i)
          return (
            <Fragment key={l.id}>
              {h && (
                <Text size={12} color={C.dim} weight={600} style={{ marginTop: i ? 10 : 0 }}>
                  {h}
                </Text>
              )}
              <LessonRow lesson={l} now={now} />
            </Fragment>
          )
        })}
      </Col>
      {shelf && pages > 1 && (
        <Row testId="pager" style={{ gap: 6, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button testId="page-prev" label={`‹ ${t.pagePrev}`} variant="ghost" disabled={page === 0} onPress={() => move(shelf.key, page - 1)} />
          {Array.from({ length: pages }, (_, p) => (
            <Button key={p} testId={`page-${p + 1}`} label={String(p + 1)} variant={p === page ? 'primary' : 'ghost'} onPress={() => move(shelf.key, p)} />
          ))}
          <Button testId="page-next" label={`${t.pageNext} ›`} variant="ghost" disabled={page === pages - 1} onPress={() => move(shelf.key, page + 1)} />
        </Row>
      )}
    </Col>
  )
}
