import { Link } from 'react-router-dom'
import { relativeTime } from '../app/i18n'
import { useSettings } from '../app/settings'
import type { Lesson } from '../lib/db'
import { dueAt, isGraduated, TOTAL_ROUNDS } from '../lib/schedule'

export function RoundDots({ done }: { done: number }) {
  return (
    <span className="round-dots" aria-label={`${done}/${TOTAL_ROUNDS}`}>
      {Array.from({ length: TOTAL_ROUNDS }, (_, k) => (
        <span key={k} className={k < done ? 'on' : ''} />
      ))}
    </span>
  )
}

export function LessonRow({ lesson, now }: { lesson: Lesson; now: number }) {
  const { t, settings } = useSettings()
  const { roundsDone } = lesson.progress
  const due = dueAt(lesson.progress)
  const label = isGraduated(lesson.progress)
    ? t.graduated
    : roundsDone === 0
      ? t.firstStudy
      : t.reviewN(roundsDone)
  return (
    <Link to={`/lesson/${lesson.id}`} className="lesson-row">
      <div className="lesson-main">
        <div className="lesson-title" lang="ja">
          {lesson.title}
          {lesson.level && <span className="pill">{lesson.level}</span>}
          {roundsDone === 0 && <span className="pill new">{t.newLesson}</span>}
        </div>
        <div className="muted small">
          {label}
          {due !== null && due > now && ` · ${t.dueIn(relativeTime(settings.lang, due, now))}`}
          {lesson.resume && ` · ${t.continue}`}
        </div>
      </div>
      <RoundDots done={roundsDone} />
    </Link>
  )
}
