import { relativeTime } from '@kikitori/core/i18n'
import { dueAt, isGraduated, ROUNDS, type Step } from '@kikitori/core/schedule'
import { useState } from 'react'
import { useApp, useQuery } from '../context'
import { JapaneseText } from '../ui/JapaneseText'
import { RoundDots } from '../ui/LessonRow'
import { Button, Col, Pill, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { VoiceCredit } from '../ui/VoiceCredit'

export function Lesson({ id }: { id: number }) {
  const { t, db, store, analyzer, settings, navigate, showWord } = useApp()
  const lesson = useQuery(() => db.lessons.get(id), [id])
  const [now] = useState(() => Date.now())
  const [confirming, setConfirming] = useState(false)
  if (!lesson) return null

  const round = ROUNDS[lesson.progress.roundsDone]
  const due = dueAt(lesson.progress)
  const remove = async () => {
    if (!confirming) return setConfirming(true)
    await store.deleteLesson(id)
    navigate({ name: 'library' })
  }
  return (
    <Col style={{ gap: 16 }}>
      <Row>
        <Button testId="back" label={`‹ ${t.navLibrary}`} variant="ghost" onPress={() => navigate({ name: 'library' })} />
      </Row>
      <Col style={{ gap: 8 }}>
        <Text size={30} ja weight={700}>
          {lesson.title}
        </Text>
        <Row style={{ gap: 10, alignItems: 'center' }}>
          {lesson.level && <Pill label={lesson.level} />}
          <Text color={C.dim}>{t.sentences(lesson.sentences.length)}</Text>
          <RoundDots done={lesson.progress.roundsDone} />
        </Row>
        {/* Read aloud: in the chosen voice. */}
        {!lesson.mediaId && <VoiceCredit />}
      </Col>
      <Col style={{ gap: 4, padding: 16, borderRadius: 10, backgroundColor: C.panel }}>
        {round ? (
          <>
            <Text size={12} color={C.dim} weight={600}>
              {t.roundOf(round.index)}
            </Text>
            <Text>{round.steps.map((s) => t.steps[s]).join(' → ')}</Text>
            {due !== null && due > now && (
              <Text size={12} color={C.dim}>
                {t.dueIn(relativeTime(settings.lang, due, now))}
              </Text>
            )}
            <Row style={{ marginTop: 10 }}>
              <Button testId="start" variant="primary" label={`▶ ${lesson.resume?.round === lesson.progress.roundsDone ? t.continue : t.start}`} onPress={() => navigate({ name: 'study', id })} />
            </Row>
          </>
        ) : (
          <Text>{isGraduated(lesson.progress) ? t.mastered : ''}</Text>
        )}
      </Col>
      <Col style={{ gap: 8 }}>
        <Text size={12} color={C.dim} weight={600}>
          {t.freePractice.toUpperCase()}
        </Text>
        <Text size={12} color={C.dim}>
          {t.freePracticeHint}
        </Text>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          {(['intensive', 'shadowing', 'blind', 'retell', 'hardSentences'] as Step[])
            .filter((s) => s !== 'hardSentences' || lesson.hard.length > 0)
            .map((s) => (
              <Button key={s} testId={`practice-${s}`} label={t.steps[s]} onPress={() => navigate({ name: 'study', id, free: s })} />
            ))}
        </Row>
      </Col>
      <Col testId="transcript" style={{ gap: 18 }}>
        {lesson.sentences.map((s, i) => (
          <Col key={i} style={{ gap: 4, padding: 10, borderRadius: 8, ...(lesson.hard.includes(i) ? { backgroundColor: C.hard } : {}) }}>
            <JapaneseText
              text={s.text}
              analyzer={analyzer}
              furigana={settings.furigana}
              chunked={settings.chunks}
              testIdPrefix={`word-${i}`}
              onWord={(token) => showWord({ token, lessonId: id, context: s.text })}
            />
            {settings.translation && s.translations?.[settings.lang] && <Text color={C.dim}>{s.translations[settings.lang]}</Text>}
          </Col>
        ))}
      </Col>
      <Row style={{ marginTop: 12 }}>
        <Button testId="delete" label={confirming ? t.confirmDelete : t.deleteLesson} variant="danger" onPress={remove} />
      </Row>
    </Col>
  )
}
