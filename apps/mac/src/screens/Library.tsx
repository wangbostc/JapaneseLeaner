import { useState } from 'react'
import { useApp, useQuery } from '../context'
import { LessonRow } from '../ui/LessonRow'
import { Button, Col, Row, Text } from '../ui/primitives'

export function Library() {
  const { t, db, navigate } = useApp()
  // Newest first, as in the web app.
  const lessons = useQuery(async () => (await db.lessons.all()).sort((a, b) => b.createdAt - a.createdAt || b.id! - a.id!), [])
  const [now] = useState(() => Date.now())
  return (
    <Col style={{ gap: 14 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text size={28} weight={700}>
          {t.navLibrary}
        </Text>
        <Button testId="import" label={`+ ${t.importLesson}`} variant="primary" onPress={() => navigate({ name: 'import' })} />
      </Row>
      <Col testId="library" style={{ gap: 8 }}>
        {lessons?.map((l) => (
          <LessonRow key={l.id} lesson={l} now={now} />
        ))}
      </Col>
    </Col>
  )
}
