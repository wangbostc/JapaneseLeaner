import { readingOf } from '@kikitori/core/scoring'
import { useEffect, useState } from 'react'
import { useApp } from '../context'
import { JapaneseText } from '../ui/JapaneseText'
import { Button, Col, Pressable, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { Card, Counter, NavRow } from './parts'
import type { StepProps } from './types'

/** Sentence by sentence: listen until it's clear, then check against the text. */
export function Intensive(props: StepProps) {
  const i = Math.min(props.position, props.lesson.sentences.length - 1)
  // Keyed by sentence so per-sentence state (revealed, saved) starts fresh.
  return <IntensiveSentence key={i} {...props} i={i} />
}

function IntensiveSentence({ lesson, player, onPosition, onDone, i }: StepProps & { i: number }) {
  const { t, settings, analyzer, store, showWord } = useApp()
  const [revealed, setRevealed] = useState(false)
  const [savedSentence, setSavedSentence] = useState(false)
  const s = lesson.sentences[i]
  const hard = lesson.hard.includes(i)
  const last = i === lesson.sentences.length - 1

  useEffect(() => {
    void player.play(s, settings.rate)
    return () => player.stop()
    // Play once per sentence.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveSentence = async () => {
    await store.addCard({ lessonId: lesson.id, kind: 'sentence', front: s.text, reading: readingOf(analyzer, s.text), context: s.text })
    setSavedSentence(true)
  }

  return (
    <Col style={{ gap: 16 }}>
      <Counter n={i + 1} of={lesson.sentences.length} />
      <Card testId="sentence">
        {revealed ? (
          <>
            <JapaneseText
              text={s.text}
              analyzer={analyzer}
              furigana={settings.furigana}
              chunked={settings.chunks}
              size={26}
              testIdPrefix="word"
              onWord={(token) => showWord({ token, lessonId: lesson.id, context: s.text })}
            />
            {settings.translation && s.translations?.[settings.lang] && <Text color={C.dim}>{s.translations[settings.lang]}</Text>}
          </>
        ) : (
          <Pressable testId="conceal" onPress={() => setRevealed(true)} style={{ justifyContent: 'center' }}>
            <Text size={26} color={C.faint} ja>
              {'・'.repeat(Math.min(s.text.length, 24))}
            </Text>
          </Pressable>
        )}
      </Card>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button testId="replay" label={t.replay} onPress={() => void player.play(s, settings.rate)} />
        <Button testId="slow" label={t.slow} onPress={() => void player.play(s, settings.rate * 0.7)} />
        <Button testId="reveal" label={revealed ? t.hide : t.reveal} onPress={() => setRevealed((r) => !r)} />
        <Button testId="mark-hard" label={t.markHard} variant={hard ? 'danger' : 'plain'} onPress={() => void store.setHard(lesson.id, i, !hard)} />
        <Button testId="save-sentence" label={savedSentence ? t.saved : t.saveSentence} onPress={saveSentence} disabled={savedSentence} />
      </Row>
      <NavRow onBack={i === 0 ? undefined : () => onPosition(i - 1)} onNext={() => (last ? onDone() : onPosition(i + 1))} last={last} />
    </Col>
  )
}
