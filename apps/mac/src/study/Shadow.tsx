import { gradeFor, readingOf, scoreShadowing, type ShadowingResult } from '@kikitori/core/scoring'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context'
import { JapaneseText } from '../ui/JapaneseText'
import { Button, Col, Pill, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { AttemptControls } from './Attempt'
import { Card, Counter, NavRow, SelfRate } from './parts'
import type { StepProps } from './types'
import { useAttempt } from './useAttempt'

interface Props extends StepProps {
  /** Sentence indices to drill, in order. */
  indices: number[]
  /** 'hard' drills take a sentence out of the hard set once it scores 75 or better. */
  mode: 'shadow' | 'hard'
}

const SELF_RATE_SCORE = { good: 90, ok: 65, bad: 30 } as const
const GRADE_COLOR = { S: C.good, A: C.good, B: C.ruby, C: C.danger } as const

export function Shadow(props: Props) {
  const p = Math.min(props.position, props.indices.length - 1)
  // Keyed by position so each sentence starts with a fresh attempt.
  return <ShadowSentence key={p} {...props} p={p} />
}

function ShadowSentence({ lesson, player, onPosition, onDone, indices, mode, p }: Props & { p: number }) {
  const { t, settings, analyzer, store } = useApp()
  const attempt = useAttempt()
  const [selfRated, setSelfRated] = useState<ShadowingResult | null>(null)
  const i = indices[p]
  const s = lesson.sentences[i]
  const last = p === indices.length - 1

  useEffect(() => {
    void player.play(s, settings.rate)
    return () => player.stop()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scored = useMemo(
    () => (attempt.phase === 'done' && attempt.transcript ? scoreShadowing(readingOf(analyzer, s.text), readingOf(analyzer, attempt.transcript)) : null),
    [analyzer, s.text, attempt.phase, attempt.transcript],
  )
  const result = scored ?? selfRated

  // A weak attempt puts the sentence in the hard set; a strong one in the drill takes it out.
  useEffect(() => {
    if (!result) return
    if (result.grade === 'C') void store.setHard(lesson.id, i, true)
    else if (mode === 'hard' && result.score >= 75) void store.setHard(lesson.id, i, false)
  }, [result, lesson.id, i, mode, store])

  const needsSelfRate = attempt.phase === 'done' && !result && (!attempt.canScore || !attempt.transcript)

  return (
    <Col style={{ gap: 16 }}>
      <Counter n={p + 1} of={indices.length}>
        {lesson.hard.includes(i) && <Pill label={t.markHard} />}
      </Counter>
      <Card testId="sentence">
        <JapaneseText text={s.text} analyzer={analyzer} furigana={settings.furigana} chunked={settings.chunks} size={26} />
        {settings.translation && s.translations?.[settings.lang] && <Text color={C.dim}>{s.translations[settings.lang]}</Text>}
      </Card>
      {result && (
        <Row testId="shadow-result" style={{ gap: 16, alignItems: 'center', padding: 14, borderRadius: 10, backgroundColor: C.raised }}>
          <Text size={36} weight={700} color={GRADE_COLOR[result.grade]}>
            {result.grade}
          </Text>
          <Col style={{ gap: 4 }}>
            <Text size={18} weight={600}>
              {String(result.score)}
            </Text>
            {result.marks.length > 0 && (
              <Row style={{ flexWrap: 'wrap' }}>
                {result.marks.map((m, k) => (
                  <Text key={k} ja size={16} color={m.hit ? C.good : C.danger}>
                    {m.char}
                  </Text>
                ))}
              </Row>
            )}
            {attempt.transcript && (
              <Text ja color={C.dim}>
                {`「${attempt.transcript}」`}
              </Text>
            )}
          </Col>
        </Row>
      )}
      {needsSelfRate && <SelfRate prompt={attempt.canScore ? t.selfRate : t.noRecognition} onRate={(k) => setSelfRated({ score: SELF_RATE_SCORE[k], grade: gradeFor(SELF_RATE_SCORE[k]), marks: [] })} />}
      <Row style={{ gap: 8 }}>
        <Button testId="replay" label={t.replay} onPress={() => void player.play(s, settings.rate)} disabled={attempt.busy} />
      </Row>
      <AttemptControls
        attempt={attempt}
        onBeforeStart={() => {
          player.stop()
          setSelfRated(null)
        }}
      />
      <NavRow
        onBack={p === 0 ? undefined : () => onPosition(p - 1)}
        onNext={() => (last ? onDone() : onPosition(p + 1))}
        last={last}
        disabled={attempt.busy}
      />
    </Col>
  )
}
