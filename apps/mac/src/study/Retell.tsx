import { contentLemmas, gradeFor, readingOf, scoreRetell, type RetellResult } from '@kikitori/core/scoring'
import { useMemo, useState } from 'react'
import { useApp } from '../context'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { AttemptControls } from './Attempt'
import { NavRow, SelfRate } from './parts'
import type { StepProps } from './types'
import { useAttempt } from './useAttempt'

/** Say the passage back in your own words, prompted by its key words. */
export function Retell({ lesson, player, onDone }: StepProps) {
  const { t, settings, analyzer } = useApp()
  const attempt = useAttempt()
  const [playing, setPlaying] = useState(false)
  const passage = lesson.sentences.map((s) => s.text).join('')
  // Every content word is shown, since every one counts towards coverage.
  const keywords = useMemo(() => [...contentLemmas(analyzer.tokenize(passage))], [analyzer, passage])
  const result: RetellResult | null = useMemo(
    () => (attempt.phase === 'done' && attempt.transcript ? scoreRetell(analyzer, passage, attempt.transcript) : null),
    [analyzer, passage, attempt.phase, attempt.transcript],
  )
  const missed = new Set(result?.missed)

  const listenAgain = async () => {
    setPlaying(true)
    await player.playAll(lesson.sentences, settings.rate)
    setPlaying(false)
  }

  return (
    <Col style={{ gap: 16 }}>
      <Text size={12} color={C.dim} weight={600}>
        {t.keyWords.toUpperCase()}
      </Text>
      <Row testId="keywords" style={{ gap: 8, flexWrap: 'wrap' }}>
        {keywords.map((w) => {
          const reading = readingOf(analyzer, w)
          const color = result ? (missed.has(w) ? C.danger : C.good) : C.text
          return (
            <Row key={w} style={{ gap: 4, alignItems: 'flex-end', paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 14, backgroundColor: C.raised }}>
              <Text ja color={color}>
                {w}
              </Text>
              {settings.furigana && reading !== w && (
                <Text ja size={11} color={C.dim}>
                  {reading}
                </Text>
              )}
            </Row>
          )
        })}
      </Row>
      {result && (
        <Row testId="retell-result" style={{ gap: 16, alignItems: 'center', padding: 14, borderRadius: 10, backgroundColor: C.raised }}>
          <Text size={30} weight={700} color={gradeFor(result.coverage) === 'C' ? C.danger : C.good}>
            {`${result.coverage}%`}
          </Text>
          <Col style={{ gap: 4 }}>
            <Text>{t.coverage(result.coverage)}</Text>
            <Text ja color={C.dim}>{`「${attempt.transcript}」`}</Text>
          </Col>
        </Row>
      )}
      {attempt.phase === 'done' && !result && <SelfRate prompt={attempt.canScore ? t.selfRate : t.noRecognition} onRate={onDone} />}
      <Row style={{ gap: 8 }}>
        <Button testId="replay" label={t.replay} onPress={() => void listenAgain()} disabled={playing || attempt.busy} />
      </Row>
      <AttemptControls attempt={attempt} onBeforeStart={() => player.stop()} />
      <NavRow onNext={onDone} last disabled={attempt.busy} />
    </Col>
  )
}
