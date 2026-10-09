import { coreRank, introduceCoreWords, isCoreCard } from '@kikitori/core/coreWords'
import type { Flashcard } from '@kikitori/core/model'
import { CARD_MODES, cardKey, modeOf, recallPrompt, type CardMode, type CardModeSetting } from '@kikitori/core/review'
import { previewIntervals, Rating, type Grade } from '@kikitori/core/srs'
import type { GradeUndo } from '@kikitori/core/store'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useQuery, useResource } from '../context'
import { ExampleSentences } from '../ui/ExampleSentences'
import { Choice, Field } from '../ui/form'
import { Meanings } from '../ui/Meanings'
import { PitchAccent } from '../ui/PitchAccent'
import { Button, Col, Pressable, Row, Text } from '../ui/primitives'
import { C } from '../ui/theme'
import { VoiceCredit } from '../ui/VoiceCredit'

const fmtDays = (d: number) => (d < 1 / 24 ? `${Math.max(1, Math.round(d * 1440))}m` : d < 1 ? `${Math.round(d * 24)}h` : `${Math.round(d)}d`)

/** How long "Grade undone." stays. */
const MESSAGE_MS = 3000

function CoreLabel({ card }: { card: Flashcard }) {
  const { t } = useApp()
  return (
    <Text testId="core-label" color={C.dim}>
      {t.coreWordLabel(coreRank(card))}
    </Text>
  )
}

/** The saved word inside its sentence, when it appears as written. */
function Context({ card }: { card: Flashcard }) {
  if (isCoreCard(card)) return <CoreLabel card={card} />
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
  const { t, settings, updateSettings, store, db, audio, dictionary, keys, navigate } = useApp()
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
  // Keys arrive faster than renders: the guard against a second grade (or undo) meanwhile, lifted
  // once the result has rendered (so the next key is handled with the next card).
  const working = useRef(false)
  const [settled, setSettled] = useState(0)
  useEffect(() => {
    working.current = false
  }, [settled])
  const [flipped, setFlipped] = useState(false)
  // What each of this session's grades changed, newest last, for Undo.
  const [undos, setUndos] = useState<GradeUndo[]>([])
  const [message, setMessage] = useState<{ text: string } | null>(null)
  // A Mix session keeps each card's mode, even past midnight.
  const [now] = useState(() => Date.now())
  const dict = useResource(dictionary)
  const card = queue?.find((c) => !done.has(c.id!))
  // Tagged with its lesson, so a card's translation is never the previous card's lesson's.
  const loaded = useQuery(async () => (card ? { id: card.lessonId, lesson: await db.lessons.get(card.lessonId) } : null), [card?.lessonId])
  const lesson = card && loaded?.id === card.lessonId ? loaded : undefined
  const intervals = useMemo(() => (card ? previewIntervals(card.card, new Date()) : null), [card])
  const translation = card && lesson?.lesson?.sentences.find((s) => s.text === card.context)?.translations?.[settings.lang]

  // Recall asks with the meanings or the translation: until they've loaded the front stays empty
  // (rather than show the Japanese, then hide it), and without them the card is read.
  const wanted = card && modeOf(card, settings.cardMode, now)
  const waiting = !!card && wanted === 'recall' && (card.kind === 'word' ? dict === undefined : !lesson)
  const prompt = card && wanted === 'recall' && !waiting ? recallPrompt(card, dict ?? null, translation) : null
  const mode: CardMode | undefined = waiting ? undefined : wanted === 'recall' && !prompt ? 'read' : wanted
  // Playing a recall card would answer it.
  const canPlay = flipped || mode === 'read' || mode === 'listen'
  const play = () => {
    if (card) void audio.speak(card.kind === 'word' ? card.front : card.context || card.front, settings.rate)
  }

  // A listening card plays as it appears (again after an undo brings it back).
  useEffect(() => {
    if (mode === 'listen') play()
    // Once per card, not on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, mode])
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [message])

  const exclusive = async (task: () => Promise<void>) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
      setSettled((n) => n + 1)
    }
  }
  const grade = (g: Grade) =>
    exclusive(async () => {
      if (!card) return
      const before = await store.gradeCard(card.id!, g)
      if (before) setUndos((u) => [...u, before])
      setDone((d) => new Set(d).add(card.id!))
      setFlipped(false)
      setMessage(null)
    })
  // The card comes back as it was before the grade (the queue still holds that), unless the
  // grade has synced meanwhile.
  const undo = () =>
    exclusive(async () => {
      const last = undos.at(-1)
      if (!last) return
      const undone = await store.undoGrade(last)
      setUndos((u) => u.filter((e) => e !== last))
      if (undone) {
        setDone((d) => {
          const next = new Set(d)
          next.delete(last.id)
          return next
        })
        setFlipped(false)
      }
      setMessage({ text: undone ? t.undone : t.undoSynced })
    })

  // Space or Enter shows the answer, 1–4 grade, R plays, U undoes.
  const onKey = useRef((_key: string) => {})
  useEffect(() => {
    onKey.current = (key) => {
      const action = cardKey(key, flipped)
      if (action === 'undo') void undo()
      else if (action === 'play') {
        if (canPlay) play()
      } else if (action === 'flip') {
        if (card) setFlipped(true)
      } else if (action) void grade(action)
    }
  })
  useEffect(() => keys.subscribe((key) => onKey.current(key)), [keys])

  if (!queue) return null

  const heading = (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Text size={28} weight={700}>
        {t.navCards}
      </Text>
      <Row style={{ gap: 12, alignItems: 'center' }}>
        {card && <Text color={C.dim} testId="card-counter">{`${done.size + 1} ${t.of} ${queue.length}`}</Text>}
        <Button testId="all-cards" label={`${t.allCards} ›`} variant="ghost" onPress={() => navigate({ name: 'cardList' })} />
      </Row>
    </Row>
  )
  const undoRow = (undos.length > 0 || message) && (
    <Row style={{ gap: 12, alignItems: 'center' }}>
      {undos.length > 0 && <Button testId="undo" label={t.undo} variant="ghost" disabled={busy} onPress={() => void undo()} />}
      {message && (
        <Text testId="undo-message" color={C.dim}>
          {message.text}
        </Text>
      )}
    </Row>
  )
  if (!card)
    return (
      <Col style={{ gap: 14 }}>
        {heading}
        <Text color={C.dim} testId="cards-empty">
          {done.size ? t.cardsDoneToday : t.noCards}
        </Text>
        {undoRow}
      </Col>
    )

  const front = flipped || mode === 'read'
  return (
    <Col style={{ gap: 16 }}>
      {heading}
      <Field label={t.cardMode} hint={t.cardModeHint}>
        <Choice
          testId="card-mode"
          value={settings.cardMode}
          onChange={(cardMode) => updateSettings({ cardMode })}
          options={CARD_MODES.map((m): [CardModeSetting, string] => [m, t.cardModes[m]])}
        />
      </Field>
      <Col testId="flashcard" style={{ gap: 12, padding: 24, borderRadius: 12, backgroundColor: C.panel }}>
        {front && (
          <Text ja size={card.kind === 'word' ? 34 : 22} weight={600}>
            {card.front}
          </Text>
        )}
        {front ? <Context card={card} /> : isCoreCard(card) && <CoreLabel card={card} />}
        {!flipped && mode === 'listen' && (
          <Col testId="card-prompt">
            <Text color={C.dim}>{t.listenPrompt}</Text>
          </Col>
        )}
        {!flipped && mode === 'recall' && prompt && (
          <Col testId="card-prompt" style={{ gap: 6 }}>
            <Text color={C.dim}>{t.recallPrompt}</Text>
            {card.kind === 'word' ? (
              prompt.map((line, i) => <Text key={i} size={18}>{`${i + 1}. ${line}`}</Text>)
            ) : (
              <Text size={18}>{prompt[0]}</Text>
            )}
          </Col>
        )}
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
        {canPlay && (
          <Row style={{ gap: 12, alignItems: 'center' }}>
            <Button testId="play-card" label={`▶ ${t.play}`} variant="ghost" onPress={play} />
            <VoiceCredit />
          </Row>
        )}
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
      <Text size={12} color={C.faint}>
        {t.cardKeys}
      </Text>
      {undoRow}
    </Col>
  )
}
