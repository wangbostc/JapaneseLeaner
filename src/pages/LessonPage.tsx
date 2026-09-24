import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { relativeTime } from '../app/i18n'
import { useSettings } from '../app/useSettings'
import { useAnalyzer } from '../app/useAnalyzer'
import { Icon } from '../components/Icon'
import { JapaneseText } from '../components/JapaneseText'
import { RoundDots } from '../components/LessonRow'
import { db } from '../lib/db'
import { dueAt, isGraduated, ROUNDS } from '../lib/schedule'
import { store } from '../lib/store'

export function LessonPage() {
  const { id } = useParams()
  const { t, settings } = useSettings()
  const navigate = useNavigate()
  const lesson = useLiveQuery(() => db.lessons.get(Number(id)), [id])
  const analyzer = useAnalyzer()
  const [confirming, setConfirming] = useState(false)
  const [now] = useState(() => Date.now())
  if (!lesson) return null

  const round = ROUNDS[lesson.progress.roundsDone]
  const due = dueAt(lesson.progress)
  const resuming = lesson.resume?.round === lesson.progress.roundsDone

  const remove = async () => {
    if (!confirming) return setConfirming(true)
    await store.deleteLesson(lesson.id!)
    navigate('/library')
  }

  return (
    <div className="page">
      <Link to="/library" className="btn ghost back-link">
        <Icon name="back" /> {t.navLibrary}
      </Link>
      <div className="lesson-hero">
        <h1 lang="ja">{lesson.title}</h1>
        <div className="muted">
          {lesson.level && <span className="pill">{lesson.level}</span>} {t.sentences(lesson.sentences.length)}
        </div>
        <RoundDots done={lesson.progress.roundsDone} />
      </div>

      {round ? (
        <div className="next-round">
          <div>
            <div className="section-label">{t.roundOf(round.index)}</div>
            <div className="step-list">{round.steps.map((s) => t.steps[s]).join(' → ')}</div>
            {due !== null && due > now && <div className="muted small">{t.dueIn(relativeTime(settings.lang, due, now))}</div>}
          </div>
          <Link to={`/lesson/${lesson.id}/study`} className="btn primary big">
            <Icon name="play" /> {resuming ? t.continue : t.start}
          </Link>
        </div>
      ) : (
        <div className="next-round">
          <p>{isGraduated(lesson.progress) && t.mastered}</p>
        </div>
      )}

      <ol className="transcript">
        {lesson.sentences.map((s, i) => (
          <li key={i} className={lesson.hard.includes(i) ? 'is-hard' : ''}>
            <JapaneseText text={s.text} analyzer={analyzer.status === 'ready' ? analyzer.analyzer : null} furigana={settings.furigana} />
            {settings.translation && s.translations?.[settings.lang] && <div className="translation">{s.translations[settings.lang]}</div>}
          </li>
        ))}
      </ol>

      <button className={`btn danger ${confirming ? 'confirm' : ''}`} onClick={remove} onBlur={() => setConfirming(false)}>
        <Icon name="trash" /> {confirming ? t.confirmDelete : t.deleteLesson}
      </button>
    </div>
  )
}
