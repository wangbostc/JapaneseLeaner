import type { ReactNode } from 'react'
import { useApp } from '../context'
import { Button, Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'

/** "3 of 6", and the step's back/next buttons. */
export function Counter({ n, of, children }: { n: number; of: number; children?: ReactNode }) {
  const { t } = useApp()
  return (
    <Row style={{ gap: 10, alignItems: 'center' }}>
      <Text color={C.dim} testId="counter">{`${n} ${t.of} ${of}`}</Text>
      {children}
    </Row>
  )
}

export function NavRow({ onBack, onNext, last, disabled }: { onBack?: () => void; onNext: () => void; last: boolean; disabled?: boolean }) {
  const { t } = useApp()
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
      {onBack ? <Button testId="prev" label={`‹ ${t.back}`} variant="ghost" onPress={onBack} disabled={disabled} /> : <Row />}
      <Button testId="next" label={`${last ? t.finishStep : t.next} ›`} variant="primary" onPress={onNext} disabled={disabled} />
    </Row>
  )
}

/** The card a sentence sits in. */
export function Card({ children, testId }: { children?: ReactNode; testId?: string }) {
  return (
    <Col testId={testId} style={{ gap: 10, padding: 22, borderRadius: 12, backgroundColor: C.panel, minHeight: 110, justifyContent: 'center' }}>
      {children}
    </Col>
  )
}

/** Three buttons for rating an attempt yourself (no recognition, or nothing heard). */
export function SelfRate({ prompt, onRate }: { prompt: string; onRate: (k: 'good' | 'ok' | 'bad') => void }) {
  const { t } = useApp()
  return (
    <Col style={{ gap: 8 }} testId="self-rate">
      <Text>{prompt}</Text>
      <Row style={{ gap: 8 }}>
        <Button testId="rate-good" label={t.rateGood} onPress={() => onRate('good')} />
        <Button testId="rate-ok" label={t.rateOk} onPress={() => onRate('ok')} />
        <Button testId="rate-bad" label={t.rateBad} onPress={() => onRate('bad')} />
      </Row>
    </Col>
  )
}
