import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { relativeTime } from '../app/i18n'
import { useAiKey } from '../app/aiKey'
import { useSettings } from '../app/useSettings'
import { useAnalyzer } from '../app/useAnalyzer'
import { AddToCalendar } from '../components/AddToCalendar'
import { Icon } from '../components/Icon'
import { JapaneseText } from '../components/JapaneseText'
import { RoundDots } from '../components/LessonRow'
import type { AiErrorCode } from '../lib/ai'
import { db } from '../lib/db'
import { dueAt, isGraduated, ROUNDS, type Step } from '../lib/schedule'
import { store } from '../lib/store'

export function LessonPage() {
  const { id } = useParams()
  const { t, settings } = useSettings()
  const navigate = useNavigate()
  const lesson = useLiveQuery(() => db.lessons.get(Number(id)), [id])
  const analyzer = useAnalyzer()
  const [confirming, setConfirming] = useState(false)
  const [now] = useState(() => Date.now())
  const aiKey = useAiKey()
  const [translating, setTranslating] = useState(false)
  const [aiError, setAiError] = useState<AiErrorCode | null>(null)
  if (!lesson) return null

  const missingTranslation = lesson.sentences.some((s) => !s.translations?.[settings.lang])
  const translate = async () => {
    setTranslating(true)
    setAiError(null)
    let ai: typeof import('../lib/ai') | null = null
    try {
      // Loaded on demand: learners without a key never download the SDK.
      ai = await import('../lib/ai')
      const out = await ai.translateSentences(ai.createAiClient(aiKey), lesson.sentences.map((s) => s.text), settings.lang)
      await store.setTranslations(lesson.id!, settings.lang, out)
    } catch (e) {
      // No module means the chunk itself failed to load (offline, or replaced by a deploy).
      setAiError(ai ? ai.aiErrorCode(e) : 'offline')
    } finally {
      setTranslating(false)
    }
  }

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
          {due !== null && due > now && <AddToCalendar lesson={lesson as typeof lesson & { id: number }} />}
          <Link to={`/lesson/${lesson.id}/study`} className="btn primary big">
            <Icon name="play" /> {resuming ? t.continue : t.start}
          </Link>
        </div>
      ) : (
        <div className="next-round">
          <p>{isGraduated(lesson.progress) && t.mastered}</p>
        </div>
      )}

      {aiKey && missingTranslation && (
        <div className="row">
          <button className="btn" onClick={translate} disabled={translating}>
            ✦ {translating ? t.translating : t.translateAi}
          </button>
          {aiError && <span className="error small">{t.aiErrors[aiError]}</span>}
        </div>
      )}

      <section className="free-practice" aria-labelledby="free-practice-title">
        <h2 className="section-label" id="free-practice-title">
          {t.freePractice}
        </h2>
        <p className="muted small">{t.freePracticeHint}</p>
        <div className="row">
          {(['intensive', 'shadowing', 'blind', 'retell', 'hardSentences'] as Step[])
            .filter((s) => s !== 'hardSentences' || lesson.hard.length > 0)
            .map((s) => (
              <Link key={s} className="btn" to={`/lesson/${lesson.id}/practice/${s}`}>
                {t.steps[s]}
              </Link>
            ))}
        </div>
      </section>

      <ol className="transcript">
        {lesson.sentences.map((s, i) => (
          <li key={i} className={lesson.hard.includes(i) ? 'is-hard' : ''}>
            <JapaneseText text={s.text} analyzer={analyzer.status === 'ready' ? analyzer.analyzer : null} furigana={settings.furigana} chunked={settings.chunks} />
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
