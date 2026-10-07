import { useState } from 'react'
import { useApp, useQuery } from '../context'
import { LessonRow } from '../ui/LessonRow'
import { Col, Text } from '../ui/primitives'

export function Library() {
  const { t, db } = useApp()
  // Newest first, as in the web app.
  const lessons = useQuery(async () => (await db.lessons.all()).sort((a, b) => b.createdAt - a.createdAt || b.id! - a.id!), [])
  const [now] = useState(() => Date.now())
  return (
    <Col style={{ gap: 14 }}>
      <Text size={28} weight={700}>
        {t.navLibrary}
      </Text>
      <Col testId="library" style={{ gap: 8 }}>
        {lessons?.map((l) => (
          <LessonRow key={l.id} lesson={l} now={now} />
        ))}
      </Col>
    </Col>
  )
}
