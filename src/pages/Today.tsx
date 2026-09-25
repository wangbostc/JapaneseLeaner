import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDuration } from '../app/i18n'
import { useSettings } from '../app/useSettings'
import { Icon } from '../components/Icon'
import { LessonRow } from '../components/LessonRow'
import { db } from '../lib/db'
import { summarizeDue } from '../lib/reminders'
import { store } from '../lib/store'

export function Today() {
  const { t } = useSettings()
  const [now, setNow] = useState(() => Date.now())
  const agenda = useLiveQuery(() => store.agenda(now), [now])
  const lessons = useLiveQuery(() => db.lessons.toArray(), [])
  // A review that comes due while Today is open moves to "Due now" on its own.
  const nextDue = lessons ? summarizeDue(lessons, now).nextDue : null
  useEffect(() => {
    if (nextDue === null) return
    // setTimeout caps at ~24.8 days; `now` in the deps re-arms it if the cap was hit.
    const timer = setTimeout(() => setNow(Date.now()), Math.min(nextDue - Date.now() + 500, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [nextDue, now])
  const cardsDue = useLiveQuery(() => db.cards.where('card.due').belowOrEqual(new Date()).count(), [])
  const stats = useLiveQuery(() => store.stats(), [])
  if (!agenda) return null

  return (
    <div className="page">
      <section className="hero">
        <h1>{t.navToday}</h1>
        <p className="muted">{t.tagline}</p>
        {stats && (
          <div className="hero-stats">
            <div>
              <strong>{stats.streak}</strong>
              <span>{t.statsStreak}</span>
            </div>
            <div>
              <strong>{formatDuration(stats.totalMs)}</strong>
              <span>{t.statsTime}</span>
            </div>
            <div>
              <strong>{stats.words}</strong>
              <span>{t.statsWords}</span>
            </div>
          </div>
        )}
      </section>

      {!!cardsDue && (
        <Link to="/cards" className="banner">
          <Icon name="cards" />
          <span>{t.cardsDue(cardsDue)}</span>
          <span className="banner-cta">
            {t.reviewCards} <Icon name="next" size={16} />
          </span>
        </Link>
      )}

      <h2 className="section-label">{t.dueNow}</h2>
      {agenda.due.length ? (
        <div className="list">
          {agenda.due.map((l) => (
            <LessonRow key={l.id} lesson={l} now={now} />
          ))}
        </div>
      ) : (
        <p className="empty">{t.nothingDue}</p>
      )}

      {agenda.upcoming.length > 0 && (
        <>
          <h2 className="section-label">{t.upcoming}</h2>
          <div className="list">
            {agenda.upcoming.map((l) => (
              <LessonRow key={l.id} lesson={l} now={now} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
