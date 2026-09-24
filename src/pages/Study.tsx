import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { relativeTime } from '../app/i18n'
import { useSettings } from '../app/useSettings'
import { useAnalyzer } from '../app/useAnalyzer'
import { Icon } from '../components/Icon'
import { Blind } from '../components/steps/Blind'
import { Intensive } from '../components/steps/Intensive'
import { Retell } from '../components/steps/Retell'
import { Shadow } from '../components/steps/Shadow'
import type { StepProps } from '../components/steps/types'
import { db, type Lesson } from '../lib/db'
import { createPlayer } from '../lib/player'
import { dueAt, isGraduated, ROUNDS, type LessonProgress, type Step } from '../lib/schedule'
import { contentLemmas } from '../lib/scoring'
import { store } from '../lib/store'

const INPUT_STEPS: Step[] = ['intensive', 'blind']
/** Longer than this without moving on is treated as the learner walking away. */
const MAX_LOGGED_MS = 20 * 60_000

export function Study() {
  const { id } = useParams()
  const lesson = useLiveQuery(() => db.lessons.get(Number(id)), [id])
  const media = useLiveQuery(async () => (lesson?.mediaId ? ((await db.media.get(lesson.mediaId)) ?? null) : null), [lesson?.mediaId])
  const analyzer = useAnalyzer()
  const { t } = useSettings()

  if (lesson === undefined || media === undefined) return null
  if (!lesson) return <p className="empty">404</p>
  if (analyzer.status === 'loading') return <p className="empty">{t.loadingDict}</p>
  if (analyzer.status === 'error') return <p className="empty error">{t.dictFailed}</p>
  return <Runner lesson={lesson as Lesson & { id: number }} media={media?.blob ?? null} analyzer={analyzer.analyzer} />
}

function Runner({ lesson, media, analyzer }: { lesson: Lesson & { id: number }; media: Blob | null; analyzer: StepProps['analyzer'] }) {
  const { t, settings } = useSettings()
  const round = ROUNDS[lesson.progress.roundsDone]
  const resume = lesson.resume?.round === lesson.progress.roundsDone ? lesson.resume : null
  const [stepIndex, setStepIndex] = useState(resume?.stepIndex ?? 0)
  const [position, setPosition] = useState(resume?.sentenceIndex ?? 0)
  const [finished, setFinished] = useState<LessonProgress | null>(null)
  const player = useMemo(() => createPlayer(media, settings.voiceURI), [media, settings.voiceURI])
  useEffect(() => () => player.dispose(), [player])

  // The hard set changes as the learner drills; freeze it when the step starts
  // and keep it in the resume point, so positions stay valid after a reload.
  const [hardAtStart, setHardAtStart] = useState(resume?.queue ?? lesson.hard)
  const busy = useRef(false)
  const step = round?.steps[stepIndex]
  const stepStarted = useRef(0)
  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  }, [step])
  const roundOver = useRef(false)

  const logStep = () => {
    const step = stepRef.current
    if (!step || roundOver.current) return
    const ms = Math.min(Date.now() - stepStarted.current, MAX_LOGGED_MS)
    store.log({ lessonId: lesson.id, step, mode: INPUT_STEPS.includes(step) ? 'input' : 'output', ms, at: Date.now() })
    stepStarted.current = Date.now()
  }
  useEffect(() => {
    stepStarted.current = Date.now()
    return logStep
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (finished) return <RoundDone progress={finished} />
  if (!round) return <Navigate to={`/lesson/${lesson.id}`} replace />

  const onPosition = (p: number) => {
    setPosition(p)
    store.saveResume(lesson.id, { round: round.index, stepIndex, sentenceIndex: p, queue: step === 'hardSentences' ? hardAtStart : undefined })
  }

  const onDone = async () => {
    if (busy.current) return
    busy.current = true
    try {
      await advance()
    } finally {
      busy.current = false
    }
  }

  const advance = async () => {
    logStep()
    if (step === 'intensive') {
      await store.addKnownWords(contentLemmas(lesson.sentences.flatMap((s) => analyzer.tokenize(s.text))))
    }
    if (stepIndex + 1 >= round.steps.length) {
      roundOver.current = true
      player.stop()
      const progress = await store.finishRound(lesson.id, round.index)
      setFinished(progress ?? null)
      return
    }
    const next = stepIndex + 1
    const queue = (await db.lessons.get(lesson.id))?.hard ?? []
    player.stop()
    setStepIndex(next)
    setPosition(0)
    setHardAtStart(queue)
    store.saveResume(lesson.id, {
      round: round.index,
      stepIndex: next,
      sentenceIndex: 0,
      queue: round.steps[next] === 'hardSentences' ? queue : undefined,
    })
  }

  const props: StepProps = { lesson, analyzer, player, position, onPosition, onDone }

  return (
    <div className="study">
      <header className="study-head">
        <Link to={`/lesson/${lesson.id}`} className="btn ghost icon-only" aria-label={t.back}>
          <Icon name="back" />
        </Link>
        <div>
          <div className="muted small" lang="ja">
            {lesson.title} · {t.roundOf(round.index)}
          </div>
          <h2>{t.steps[step!]}</h2>
        </div>
      </header>
      <ol className="stepper" aria-label={t.stepsLabel}>
        {round.steps.map((s, k) => (
          <li key={s} className={k < stepIndex ? 'done' : k === stepIndex ? 'current' : ''}>
            {t.steps[s]}
          </li>
        ))}
      </ol>
      <p className="help">{t.stepHelp[step!]}</p>
      {step === 'intensive' && <Intensive key={step} {...props} />}
      {step === 'shadowing' && <Shadow key={step} {...props} mode="shadow" indices={lesson.sentences.map((_, k) => k)} />}
      {step === 'blind' && <Blind key={step} {...props} />}
      {step === 'hardSentences' &&
        (hardAtStart.length ? (
          <Shadow key={step} {...props} mode="hard" indices={hardAtStart} />
        ) : (
          <div className="step">
            <p className="empty">{t.noHard}</p>
            <div className="nav-row end">
              <button className="btn primary" onClick={onDone}>
                {t.next} <Icon name="next" />
              </button>
            </div>
          </div>
        ))}
      {step === 'retell' && <Retell key={step} {...props} />}
    </div>
  )
}

function RoundDone({ progress }: { progress: LessonProgress }) {
  const { t, settings } = useSettings()
  const due = dueAt(progress)
  return (
    <div className="round-done">
      <div className="seal" aria-hidden="true">
        <Icon name="check" size={48} />
      </div>
      <h2>{t.roundDone}</h2>
      <p>{isGraduated(progress) ? t.mastered : due ? t.nextReview(relativeTime(settings.lang, due)) : ''}</p>
      <Link className="btn primary" to="/">
        {t.backToToday}
      </Link>
    </div>
  )
}
