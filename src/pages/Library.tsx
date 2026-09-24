import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { useSettings } from '../app/useSettings'
import { Icon } from '../components/Icon'
import { LessonRow } from '../components/LessonRow'
import { db } from '../lib/db'

export function Library() {
  const { t } = useSettings()
  const lessons = useLiveQuery(() => db.lessons.orderBy('createdAt').reverse().toArray(), [])
  const [now] = useState(() => Date.now())
  return (
    <div className="page">
      <div className="page-head">
        <h1>{t.navLibrary}</h1>
        <Link to="/import" className="btn primary">
          <Icon name="plus" /> {t.importLesson}
        </Link>
      </div>
      <div className="list">
        {lessons?.map((l) => (
          <LessonRow key={l.id} lesson={l} now={now} />
        ))}
      </div>
    </div>
  )
}
