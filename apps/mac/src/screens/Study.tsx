import { relativeTime } from '@kikitori/core/i18n'
import type { Lesson } from '@kikitori/core/model'
import { dueAt, isGraduated, ROUNDS, type LessonProgress, type Round, type Step } from '@kikitori/core/schedule'
import { contentLemmas } from '@kikitori/core/scoring'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPlayer } from '../audio/player'
import { useApp, useQuery } from '../context'
import { Blind } from '../study/Blind'
import { Intensive } from '../study/Intensive'
import { Retell } from '../study/Retell'
import { Shadow } from '../study/Shadow'
import type { StepProps } from '../study/types'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { VoiceCredit } from '../ui/VoiceCredit'
import { releaseChapterCards } from '@kikitori/core/privateLessons'

const INPUT_STEPS: Step[] = ['intensive', 'blind']
/** Longer than this without moving on is treated as the learner walking away. */
const MAX_LOGGED_MS = 20 * 60_000

export function Study({ id, free }: { id: number; free?: Step }) {
  const { db, store, mediaPath } = useApp()
  const lesson = useQuery(() => db.lessons.get(id), [id])
  // A private chapter's word cards join the reviews once the learner studies it.
  useEffect(() => {
    void releaseChapterCards(store, id)
  }, [store, id])
  // The audio file is looked up once per lesson (a sync can link it later; the runner restarts then).
  const media = useQuery(async () => {
    const l = await db.lessons.get(id)
    return l ? await mediaPath(l) : null
  }, [id, lesson?.mediaId])
  if (lesson === undefined || media === undefined) return null
  if (!lesson) return <Text color={C.dim}>404</Text>
  // Keyed so switching between practice steps starts a fresh runner.
  return <Runner key={`${free ?? 'round'}-${media ?? ''}`} lesson={lesson as Lesson & { id: number }} media={media} free={free ?? null} />
}

interface RunnerProps {
  lesson: Lesson & { id: number }
  media: string | null
  /**
   * Free practice: one step outside the schedule. It never completes a round or moves the
   * resume point; time still counts in stats, and weak sentences still become hard.
   */
  free: Step | null
}

function Runner({ lesson, media, free }: RunnerProps) {
  const { t, store, db, audio, analyzer, navigate } = useApp()
  const round: Round | undefined = free ? { index: -1, intervalMs: 0, steps: [free] } : ROUNDS[lesson.progress.roundsDone]
  const resume = !free && lesson.resume?.round === lesson.progress.roundsDone ? lesson.resume : null
  const [stepIndex, setStepIndex] = useState(resume?.stepIndex ?? 0)
  const [position, setPosition] = useState(resume?.sentenceIndex ?? 0)
  const [finished, setFinished] = useState<LessonProgress | null>(null)
  const [practiced, setPracticed] = useState(false)
  const player = useMemo(() => createPlayer(audio, media), [audio, media])
  useEffect(() => () => player.dispose(), [player])

  // The hard set changes as the learner drills; freeze it when the step starts and keep it in
  // the resume point, so positions stay valid after leaving and coming back.
  const [hardAtStart, setHardAtStart] = useState(resume?.queue ?? lesson.hard)
  const busy = useRef(false)
  const step = round?.steps[stepIndex]
  const stepStarted = useRef(0)
  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  }, [step])
  const roundOver = useRef(false)
  // Nothing left to study in this round (a mastered lesson): back to the lesson.
  useEffect(() => {
    if (!round) navigate({ name: 'lesson', id: lesson.id })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const logStep = () => {
    const current = stepRef.current
    if (!current || roundOver.current) return
    const ms = Math.min(Date.now() - stepStarted.current, MAX_LOGGED_MS)
    void store.log({ lessonId: lesson.id, step: current, mode: INPUT_STEPS.includes(current) ? 'input' : 'output', ms, at: Date.now() })
    stepStarted.current = Date.now()
  }
  useEffect(() => {
    stepStarted.current = Date.now()
    return logStep
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (practiced) return <PracticeDone lessonId={lesson.id} />
  if (finished) return <RoundDone progress={finished} />
  if (!round || !step) return null

  const onPosition = (p: number) => {
    setPosition(p)
    if (free) return
    void store.saveResume(lesson.id, { round: round.index, stepIndex, sentenceIndex: p, queue: step === 'hardSentences' ? hardAtStart : undefined })
  }

  const advance = async () => {
    logStep()
    if (step === 'intensive') await store.addKnownWords(contentLemmas(lesson.sentences.flatMap((s) => analyzer.tokenize(s.text))))
    if (free) {
      roundOver.current = true
      player.stop()
      setPracticed(true)
      return
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
    void store.saveResume(lesson.id, { round: round.index, stepIndex: next, sentenceIndex: 0, queue: round.steps[next] === 'hardSentences' ? queue : undefined })
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

  const props: StepProps = { lesson, player, position, onPosition, onDone }
  return (
    <Col style={{ gap: 18 }}>
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <Button testId="leave" label={`‹ ${t.back}`} variant="ghost" onPress={() => navigate({ name: 'lesson', id: lesson.id })} />
        <Col style={{ gap: 2 }}>
          <Text size={12} color={C.dim} ja>
            {`${lesson.title} · ${free ? t.freePractice : t.roundOf(round.index)}`}
          </Text>
          <Text size={24} weight={700} testId="step-title">
            {t.steps[step]}
          </Text>
        </Col>
      </Row>
      <Row testId="stepper" style={{ gap: 6, flexWrap: 'wrap' }}>
        {round.steps.map((s, k) => (
          <Row key={s} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 12, backgroundColor: k === stepIndex ? C.accent : k < stepIndex ? '#1f3358' : C.raised }}>
            <Text size={12} color={k === stepIndex ? '#ffffff' : k < stepIndex ? C.ruby : C.dim}>
              {t.steps[s]}
            </Text>
          </Row>
        ))}
      </Row>
      <Text color={C.dim}>{t.stepHelp[step]}</Text>
      {!media && <VoiceCredit />}
      {step === 'intensive' && <Intensive key={step} {...props} />}
      {step === 'shadowing' && <Shadow key={step} {...props} mode="shadow" indices={lesson.sentences.map((_, k) => k)} />}
      {step === 'blind' && <Blind key={step} {...props} />}
      {step === 'hardSentences' &&
        (hardAtStart.length ? (
          <Shadow key={step} {...props} mode="hard" indices={hardAtStart} />
        ) : (
          <Col style={{ gap: 12 }}>
            <Text color={C.dim}>{t.noHard}</Text>
            <Row>
              <Button testId="next" label={`${t.next} ›`} variant="primary" onPress={() => void onDone()} />
            </Row>
          </Col>
        ))}
      {step === 'retell' && <Retell key={step} {...props} />}
    </Col>
  )
}

function RoundDone({ progress }: { progress: LessonProgress }) {
  const { t, settings, navigate } = useApp()
  const due = dueAt(progress)
  return (
    <Col testId="round-done" style={{ gap: 14, alignItems: 'center', paddingTop: 40 }}>
      <Text size={48} color={C.good}>
        ✓
      </Text>
      <Text size={24} weight={700}>
        {t.roundDone}
      </Text>
      <Text color={C.dim}>{isGraduated(progress) ? t.mastered : due ? t.nextReview(relativeTime(settings.lang, due)) : ''}</Text>
      <Button testId="back-to-today" label={t.backToToday} variant="primary" onPress={() => navigate({ name: 'today' })} />
    </Col>
  )
}

function PracticeDone({ lessonId }: { lessonId: number }) {
  const { t, navigate } = useApp()
  return (
    <Col testId="practice-done" style={{ gap: 14, alignItems: 'center', paddingTop: 40 }}>
      <Text size={48} color={C.ruby}>
        ✓
      </Text>
      <Text size={24} weight={700}>
        {t.practiceDone}
      </Text>
      <Text color={C.dim}>{t.practiceDoneHint}</Text>
      <Button testId="back-to-lesson" label={t.back} variant="primary" onPress={() => navigate({ name: 'lesson', id: lessonId })} />
    </Col>
  )
}
