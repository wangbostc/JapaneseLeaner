import { useState } from 'react'
import { useApp } from '../context'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import type { StepProps } from './types'

/** The whole passage, no text: a check on real-speed comprehension. */
export function Blind({ lesson, player, onDone }: StepProps) {
  const { t, settings } = useApp()
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(-1)
  const [played, setPlayed] = useState(false)
  const [little, setLittle] = useState(false)

  const play = async () => {
    if (playing) {
      player.stop()
      setPlaying(false)
      return
    }
    setPlaying(true)
    setLittle(false)
    await player.playAll(lesson.sentences, settings.rate, setCurrent)
    setPlaying(false)
    setCurrent(-1)
    setPlayed(true)
  }

  return (
    <Col style={{ gap: 18 }}>
      <Row style={{ gap: 16, alignItems: 'center' }}>
        <Button testId="play-all" label={playing ? `■ ${t.stop}` : `▶ ${t.play}`} variant="primary" onPress={() => void play()} />
        <Row testId="dots" style={{ gap: 6 }}>
          {lesson.sentences.map((_, k) => (
            <div key={k} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: k === current ? C.accent : k < current ? C.ruby : C.line }} />
          ))}
        </Row>
      </Row>
      {played && !playing && (
        <Col testId="blind-rate" style={{ gap: 8 }}>
          <Text>{t.blindQuestion}</Text>
          <Row style={{ gap: 8 }}>
            <Button testId="blind-all" label={t.blindAll} onPress={onDone} />
            <Button testId="blind-gist" label={t.blindGist} onPress={onDone} />
            <Button testId="blind-little" label={t.blindLittle} onPress={() => setLittle(true)} />
          </Row>
          {little && (
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Text color={C.dim}>{t.blindLittleHint}</Text>
              <Button testId="blind-next" label={`${t.next} ›`} variant="ghost" onPress={onDone} />
            </Row>
          )}
        </Col>
      )}
    </Col>
  )
}
