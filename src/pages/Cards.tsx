import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useSettings } from '../app/settings'
import { Icon } from '../components/Icon'
import { db, type Flashcard } from '../lib/db'
import { speak } from '../lib/speech'
import { previewIntervals, Rating, type Grade } from '../lib/srs'
import { store } from '../lib/store'

const fmtDays = (d: number) => (d < 1 / 24 ? `${Math.max(1, Math.round(d * 1440))}m` : d < 1 ? `${Math.round(d * 24)}h` : `${Math.round(d)}d`)

/** Highlights the saved word inside its context sentence (if it appears as written). */
function Context({ card }: { card: Flashcard }) {
  if (card.kind === 'sentence') return null
  const at = card.context.indexOf(card.front)
  if (at < 0) return <p className="card-context" lang="ja">{card.context}</p>
  return (
    <p className="card-context" lang="ja">
      {card.context.slice(0, at)}
      <mark>{card.front}</mark>
      {card.context.slice(at + card.front.length)}
    </p>
  )
}

export function Cards() {
  const { t, settings } = useSettings()
  // Snapshot the queue so a graded card doesn't reshuffle the session.
  const [startedAt] = useState(() => Date.now())
  const queue = useLiveQuery(() => store.dueCards(startedAt), [startedAt])
  const [done, setDone] = useState<Set<number>>(new Set())
  const [flipped, setFlipped] = useState(false)
  const card = queue?.find((c) => !done.has(c.id!))
  const lesson = useLiveQuery(() => (card ? db.lessons.get(card.lessonId) : undefined), [card?.lessonId])
  const intervals = useMemo(() => (card ? previewIntervals(card.card, new Date()) : null), [card])

  if (!queue) return null
  if (!card)
    return (
      <div className="page">
        <h1>{t.navCards}</h1>
        <p className="empty">{done.size ? t.cardsDoneToday : t.noCards}</p>
      </div>
    )

  const translation = lesson?.sentences.find((s) => s.text === card.context)?.translations?.[settings.lang]
  const grade = async (g: Grade) => {
    await store.gradeCard(card.id!, g)
    setDone((d) => new Set(d).add(card.id!))
    setFlipped(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t.navCards}</h1>
        <span className="muted">
          {done.size + 1} {t.of} {queue.length}
        </span>
      </div>
      <div className={`flashcard ${card.kind}`} data-testid="flashcard">
        <div className="card-front" lang="ja">
          {card.front}
        </div>
        <Context card={card} />
        {flipped && (
          <div className="card-back">
            <div className="card-reading" lang="ja">
              {card.reading}
            </div>
            {translation && <p className="translation">{translation}</p>}
          </div>
        )}
        <button className="btn ghost" onClick={() => speak(card.kind === 'word' ? card.front : card.context, settings.rate, settings.voiceURI)}>
          <Icon name="play" /> {t.play}
        </button>
      </div>
      {flipped ? (
        <div className="grades">
          {(
            [
              [Rating.Again, t.again],
              [Rating.Hard, t.hard],
              [Rating.Good, t.good],
              [Rating.Easy, t.easy],
            ] as [Grade, string][]
          ).map(([g, label]) => (
            <button key={g} className={`btn grade-btn g${g}`} onClick={() => grade(g)}>
              {label}
              <small>{intervals && fmtDays(intervals[g])}</small>
            </button>
          ))}
        </div>
      ) : (
        <button className="btn primary big wide" onClick={() => setFlipped(true)}>
          {t.showAnswer}
        </button>
      )}
    </div>
  )
}
