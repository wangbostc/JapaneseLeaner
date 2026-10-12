import { readingOf, scoreShadowing, type ShadowingResult } from '@kikitori/core/scoring'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context'
import { JapaneseText } from '../ui/JapaneseText'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { AttemptControls } from './Attempt'
import { AttemptResult, Card, Counter, NavRow, SelfRate } from './parts'
import { selfRating } from './rating'
import { promptOf, sayable } from './sayable'
import type { StepProps } from './types'
import { useAttempt } from './useAttempt'

/**
 * Say it: the meaning is shown, the learner says the sentence in Japanese, then sees and hears
 * the original. Recall is a different skill from repeating, so a miss here doesn't mark the
 * sentence hard; and a right answer said another way scores low on sound, so the learner can
 * always rate themselves instead.
 */
export function Say(props: StepProps) {
  const { settings } = useApp()
  const indices = useMemo(() => sayable(props.lesson, settings.lang), [props.lesson, settings.lang])
  if (!indices.length) return null
  const p = Math.min(props.position, indices.length - 1)
  // Keyed by position so each sentence starts hidden, with a fresh attempt.
  return <SaySentence key={p} {...props} indices={indices} p={p} />
}

function SaySentence({ lesson, player, onPosition, onDone, indices, p }: StepProps & { indices: number[]; p: number }) {
  const { t, settings, analyzer } = useApp()
  const attempt = useAttempt()
  const [shown, setShown] = useState(false)
  const [selfRated, setSelfRated] = useState<ShadowingResult | null>(null)
  const s = lesson.sentences[indices[p]]
  const last = p === indices.length - 1
  // The answer shows once an attempt is over, or when the learner gives up and asks for it.
  const revealed = shown || attempt.phase === 'done'

  // Heard after every attempt (the mic is closed by then), and when the answer is asked for.
  useEffect(() => {
    if (attempt.phase === 'done') void player.play(s, settings.rate)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt.phase])
  useEffect(() => () => player.stop(), [player])

  const scored = useMemo(
    () => (attempt.phase === 'done' && attempt.transcript ? scoreShadowing(readingOf(analyzer, s.text), readingOf(analyzer, attempt.transcript)) : null),
    [analyzer, s.text, attempt.phase, attempt.transcript],
  )
  const result = selfRated ?? scored

  return (
    <Col style={{ gap: 16 }}>
      <Counter n={p + 1} of={indices.length} />
      <Card testId="prompt">
        <Text size={12} color={C.dim}>
          {t.recallPrompt}
        </Text>
        <Text size={22}>{promptOf(s, settings.lang)!}</Text>
      </Card>
      {revealed && (
        <Card testId="answer">
          <JapaneseText text={s.text} analyzer={analyzer} furigana={settings.furigana} chunked={settings.chunks} size={26} />
        </Card>
      )}
      {result && <AttemptResult result={result} transcript={attempt.transcript} />}
      {attempt.phase === 'done' && scored?.grade !== 'S' && <SelfRate prompt={!attempt.canScore ? t.noRecognition : scored ? t.sayOwnWay : t.selfRate} onRate={(k) => setSelfRated(selfRating(k))} />}
      <Row style={{ gap: 8 }}>
        {revealed ? (
          <Button testId="replay" label={t.replay} onPress={() => void player.play(s, settings.rate)} disabled={attempt.busy} />
        ) : (
          <Button testId="show-answer" label={t.showAnswer} variant="ghost" onPress={() => {
              setShown(true)
              void player.play(s, settings.rate)
            }}
            disabled={attempt.busy} />
        )}
      </Row>
      <AttemptControls
        attempt={attempt}
        onBeforeStart={() => {
          player.stop()
          setSelfRated(null)
        }}
      />
      <NavRow onBack={p === 0 ? undefined : () => onPosition(p - 1)} onNext={() => (last ? onDone() : onPosition(p + 1))} last={last} disabled={attempt.busy} />
    </Col>
  )
}
