import { coreRank, introduceCoreWords, isCoreCard } from '@kikitori/core/coreWords'
import type { Flashcard } from '@kikitori/core/model'
import { previewIntervals, Rating, type Grade } from '@kikitori/core/srs'
import { useEffect, useMemo, useState } from 'react'
import { useApp, useQuery } from '../context'
import { ExampleSentences } from '../ui/ExampleSentences'
import { Meanings } from '../ui/Meanings'
import { PitchAccent } from '../ui/PitchAccent'
import { Button, Col, Pressable, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { VoiceCredit } from '../ui/VoiceCredit'

const fmtDays = (d: number) => (d < 1 / 24 ? `${Math.max(1, Math.round(d * 1440))}m` : d < 1 ? `${Math.round(d * 24)}h` : `${Math.round(d)}d`)

/** The saved word inside its sentence, when it appears as written. */
function Context({ card }: { card: Flashcard }) {
  const { t } = useApp()
  if (isCoreCard(card))
    return (
      <Text testId="core-label" color={C.dim}>
        {t.coreWordLabel(coreRank(card))}
      </Text>
    )
  if (card.kind === 'sentence') return null
  const at = card.context.indexOf(card.front)
  if (at < 0)
    return (
      <Text ja color={C.dim}>
        {card.context}
      </Text>
    )
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      <Text ja color={C.dim}>
        {card.context.slice(0, at)}
      </Text>
      <Text ja color={C.ruby} weight={600}>
        {card.front}
      </Text>
      <Text ja color={C.dim}>
        {card.context.slice(at + card.front.length)}
      </Text>
    </Row>
  )
}

export function Cards() {
  const { t, settings, store, db, audio } = useApp()
  // The due queue is loaded once: graded cards get later due dates, and a live query would
  // drop them mid-session and throw off the counter.
  const [queue, setQueue] = useState<Flashcard[] | null>(null)
  useEffect(() => {
    // Today's new core words first (a new day may have begun since start-up).
    introduceCoreWords(db, settings.newWordsPerDay)
      .then(() => store.dueCards())
      .then(setQueue)
    // Loaded once: see above.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [store])
  const [done, setDone] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const card = queue?.find((c) => !done.has(c.id!))
  const lesson = useQuery(async () => (card ? db.lessons.get(card.lessonId) : undefined), [card?.lessonId])
  const intervals = useMemo(() => (card ? previewIntervals(card.card, new Date()) : null), [card])
  if (!queue) return null

  const heading = (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Text size={28} weight={700}>
        {t.navCards}
      </Text>
      {card && <Text color={C.dim} testId="card-counter">{`${done.size + 1} ${t.of} ${queue.length}`}</Text>}
    </Row>
  )
  if (!card)
    return (
      <Col style={{ gap: 14 }}>
        {heading}
        <Text color={C.dim} testId="cards-empty">
          {done.size ? t.cardsDoneToday : t.noCards}
        </Text>
      </Col>
    )

  const translation = lesson?.sentences.find((s) => s.text === card.context)?.translations?.[settings.lang]
  const grade = async (g: Grade) => {
    if (busy) return
    setBusy(true)
    try {
      await store.gradeCard(card.id!, g)
      setDone((d) => new Set(d).add(card.id!))
      setFlipped(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Col style={{ gap: 16 }}>
      {heading}
      <Col testId="flashcard" style={{ gap: 12, padding: 24, borderRadius: 12, backgroundColor: C.panel }}>
        <Text ja size={card.kind === 'word' ? 34 : 22} weight={600}>
          {card.front}
        </Text>
        <Context card={card} />
        {flipped && (
          <Col testId="card-back" style={{ gap: 10, paddingTop: 10, borderTopWidth: 1, borderColor: C.line }}>
            <Text ja size={18} color={C.ruby}>
              {card.reading}
            </Text>
            {card.kind === 'word' && <PitchAccent word={card.front} reading={card.reading} />}
            {card.kind === 'word' && <Meanings word={card.front} reading={card.reading} />}
            {translation && <Text color={C.dim}>{translation}</Text>}
            {card.kind === 'word' && <ExampleSentences word={card.front} reading={card.reading} />}
          </Col>
        )}
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <Button testId="play-card" label={`▶ ${t.play}`} variant="ghost" onPress={() => void audio.speak(card.kind === 'word' ? card.front : card.context, settings.rate)} />
          <VoiceCredit />
        </Row>
      </Col>
      {flipped ? (
        <Row style={{ gap: 8 }}>
          {(
            [
              [Rating.Again, t.again],
              [Rating.Hard, t.hard],
              [Rating.Good, t.good],
              [Rating.Easy, t.easy],
            ] as [Grade, string][]
          ).map(([g, label]) => (
            <Pressable
              key={g}
              testId={`grade-${g}`}
              onPress={() => void grade(g)}
              disabled={busy}
              style={{ flexGrow: 1, flexDirection: 'column', gap: 2, paddingTop: 10, paddingBottom: 10, borderRadius: 9, backgroundColor: C.raised }}
              hover={{ backgroundColor: C.hover }}
            >
              <Text weight={600}>{label}</Text>
              <Text size={12} color={C.dim}>
                {intervals ? fmtDays(intervals[g]) : ''}
              </Text>
            </Pressable>
          ))}
        </Row>
      ) : (
        <Button testId="show-answer" label={t.showAnswer} variant="primary" onPress={() => setFlipped(true)} />
      )}
    </Col>
  )
}
