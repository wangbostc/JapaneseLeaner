import { relativeTime } from '@kikitori/core/i18n'
import type { Lesson } from '@kikitori/core/model'
import { dueAt, isGraduated, TOTAL_ROUNDS } from '@kikitori/core/schedule'
import { useApp } from '../context'
import { Col, Pill, Pressable, Row, Text } from './primitives'
import { C } from './theme'

export function RoundDots({ done }: { done: number }) {
  return (
    <Row style={{ gap: 4 }}>
      {Array.from({ length: TOTAL_ROUNDS }, (_, k) => (
        <div key={k} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k < done ? C.accent : C.line }} />
      ))}
    </Row>
  )
}

export function LessonRow({ lesson, now }: { lesson: Lesson; now: number }) {
  const { t, settings, navigate } = useApp()
  const { roundsDone } = lesson.progress
  const due = dueAt(lesson.progress)
  const label = isGraduated(lesson.progress) ? t.graduated : roundsDone === 0 ? t.firstStudy : t.reviewN(roundsDone)
  const detail = [label, due !== null && due > now ? t.dueIn(relativeTime(settings.lang, due, now)) : null, lesson.resume ? t.continue : null].filter(Boolean).join(' · ')
  return (
    <Pressable
      testId={`lesson-${lesson.id}`}
      onPress={() => navigate({ name: 'lesson', id: lesson.id! })}
      style={{ justifyContent: 'space-between', padding: 14, borderRadius: 10, backgroundColor: C.panel }}
      hover={{ backgroundColor: C.raised }}
    >
      <Col style={{ gap: 4 }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Text size={16} ja weight={600}>
            {lesson.title}
          </Text>
          {lesson.level && <Pill label={lesson.level} />}
          {roundsDone === 0 && <Pill label={t.newLesson} accent />}
        </Row>
        <Text size={12} color={C.dim}>
          {detail}
        </Text>
      </Col>
      <RoundDots done={roundsDone} />
    </Pressable>
  )
}
