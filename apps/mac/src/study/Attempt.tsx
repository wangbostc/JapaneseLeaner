import { useApp } from '../context'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import type { useAttempt } from './useAttempt'

/** The microphone button, what's being heard, any error, and playback of the attempt. */
export function AttemptControls({ attempt, onBeforeStart }: { attempt: ReturnType<typeof useAttempt>; onBeforeStart: () => void }) {
  const { t, audio } = useApp()
  return (
    <Col style={{ gap: 10 }}>
      {attempt.phase === 'recording' && (
        <Text testId="interim" ja color={C.ruby}>
          {attempt.interim || t.listening}
        </Text>
      )}
      {attempt.error && <Text color={C.danger}>{attempt.error}</Text>}
      <Row style={{ gap: 8, alignItems: 'center' }}>
        {attempt.phase === 'recording' ? (
          <Button testId="stop" label={`■ ${t.stop}`} variant="danger" onPress={() => void attempt.stop()} />
        ) : (
          <Button
            testId="record"
            label={`● ${attempt.phase === 'done' ? t.tryAgain : t.record}`}
            variant="primary"
            disabled={attempt.phase === 'starting'}
            onPress={() => {
              onBeforeStart() // the mic mustn't hear the voice
              void attempt.start()
            }}
          />
        )}
        {attempt.recording && attempt.phase === 'done' && <Button testId="play-attempt" label={t.yourAttempt} variant="ghost" onPress={() => void audio.playFile(attempt.recording!, 0, null, 1)} />}
      </Row>
    </Col>
  )
}
