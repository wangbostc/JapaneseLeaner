import { formatDuration } from '@kikitori/core/i18n'
import { useApp, useQuery } from '../context'
import { Col, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'

const WEEK_HEIGHT = 140

export function Stats() {
  const { t, settings, store } = useApp()
  const s = useQuery(() => store.stats(), [])
  if (!s) return null
  const max = Math.max(...s.lastWeek.map((d) => d.ms), 60_000)
  const inputPct = s.totalMs ? Math.round((s.inputMs / s.totalMs) * 100) : 50
  const dayName = new Intl.DateTimeFormat(settings.lang === 'zh' ? 'zh-CN' : 'en', { weekday: 'short' })
  const stat = (value: string | number, label: string, testId: string) => (
    <Col testId={testId} style={{ gap: 4, padding: 16, borderRadius: 10, backgroundColor: C.panel, flexGrow: 1, flexBasis: 0 }}>
      <Text size={24} weight={700}>
        {String(value)}
      </Text>
      <Text size={12} color={C.dim}>
        {label}
      </Text>
    </Col>
  )
  return (
    <Col style={{ gap: 18 }}>
      <Text size={28} weight={700}>
        {t.navStats}
      </Text>
      <Row style={{ gap: 10 }}>
        {stat(formatDuration(s.totalMs), t.statsTime, 'stat-time')}
        {stat(s.streak, t.statsStreak, 'stat-streak')}
        {stat(s.words, t.statsWords, 'stat-words')}
        {stat(s.cards, t.statsCards, 'stat-cards')}
      </Row>
      <Text size={12} color={C.dim} weight={600}>
        {t.statsInputOutput.toUpperCase()}
      </Text>
      <Row style={{ height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: C.line }}>
        <div style={{ width: `${inputPct}%`, height: 12, backgroundColor: C.accent }} />
        <div style={{ width: `${100 - inputPct}%`, height: 12, backgroundColor: C.good }} />
      </Row>
      <Row style={{ gap: 20 }}>
        <Text size={12} color={C.accent}>{`● ${formatDuration(s.inputMs)}`}</Text>
        <Text size={12} color={C.good}>{`● ${formatDuration(s.outputMs)}`}</Text>
      </Row>
      <Text size={12} color={C.dim} weight={600}>
        {t.statsWeek.toUpperCase()}
      </Text>
      {/* Heights in pixels from the week's maximum (a percentage height wouldn't resolve here). */}
      <Row testId="week" style={{ gap: 12, alignItems: 'flex-end', height: WEEK_HEIGHT + 24 }}>
        {s.lastWeek.map((d) => (
          <Col key={d.day} style={{ gap: 4, alignItems: 'center', flexGrow: 1, flexBasis: 0 }}>
            <div style={{ width: '100%', height: Math.max(2, Math.round((d.ms / max) * WEEK_HEIGHT)), borderRadius: 4, backgroundColor: d.ms ? C.accent : C.line }} />
            <Text size={11} color={C.dim}>
              {dayName.format(new Date(d.day))}
            </Text>
          </Col>
        ))}
      </Row>
    </Col>
  )
}
