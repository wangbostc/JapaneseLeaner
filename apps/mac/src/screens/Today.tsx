import { formatDuration } from '@kikitori/core/i18n'
import { summarizeDue } from '@kikitori/core/reminders'
import { useEffect, useState } from 'react'
import { useApp, useQuery } from '../context'
import { LessonRow } from '../ui/LessonRow'
import { Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'

export function Today() {
  const { t, store, db } = useApp()
  const [now, setNow] = useState(() => Date.now())
  const agenda = useQuery(() => store.agenda(now), [now])
  const lessons = useQuery(() => db.lessons.all(), [])
  const stats = useQuery(() => store.stats(), [])
  // A review that comes due while Today is open moves to "Due now" on its own.
  const nextDue = lessons ? summarizeDue(lessons, now).nextDue : null
  useEffect(() => {
    if (nextDue === null) return
    // setTimeout caps at ~24.8 days; `now` in the deps re-arms it if the cap was hit.
    const timer = setTimeout(() => setNow(Date.now()), Math.min(nextDue - Date.now() + 500, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [nextDue, now])
  if (!agenda) return null

  const stat = (value: string | number, label: string) => (
    <Col style={{ gap: 2 }}>
      <Text size={22} weight={700}>
        {String(value)}
      </Text>
      <Text size={12} color={C.dim}>
        {label}
      </Text>
    </Col>
  )
  return (
    <Col style={{ gap: 14 }}>
      <Col style={{ gap: 6 }}>
        <Text size={28} weight={700}>
          {t.navToday}
        </Text>
        <Text color={C.dim}>{t.tagline}</Text>
        {stats && (
          <Row style={{ gap: 36, marginTop: 8 }}>
            {stat(stats.streak, t.statsStreak)}
            {stat(formatDuration(stats.totalMs), t.statsTime)}
            {stat(stats.words, t.statsWords)}
          </Row>
        )}
      </Col>
      <Text size={12} color={C.dim} weight={600} style={{ marginTop: 10 }}>
        {t.dueNow.toUpperCase()}
      </Text>
      {agenda.due.length ? (
        <Col testId="due" style={{ gap: 8 }}>
          {agenda.due.map((l) => (
            <LessonRow key={l.id} lesson={l} now={now} />
          ))}
        </Col>
      ) : (
        <Text color={C.dim}>{t.nothingDue}</Text>
      )}
      {agenda.upcoming.length > 0 && (
        <>
          <Text size={12} color={C.dim} weight={600} style={{ marginTop: 10 }}>
            {t.upcoming.toUpperCase()}
          </Text>
          <Col testId="upcoming" style={{ gap: 8 }}>
            {agenda.upcoming.map((l) => (
              <LessonRow key={l.id} lesson={l} now={now} />
            ))}
          </Col>
        </>
      )}
    </Col>
  )
}
