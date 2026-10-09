import { useLiveQuery } from 'dexie-react-hooks'
import { VoiceCredit } from '../components/VoiceCredit'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '../app/useSettings'
import { useDictionary } from '../app/useDictionary'
import { holdSync, syncIdle } from '../app/sync'
import { Icon } from '../components/Icon'
import { ExampleSentences } from '../components/ExampleSentences'
import { Meanings } from '../components/Meanings'
import { PitchAccent } from '../components/PitchAccent'
import { type Flashcard } from '@kikitori/core/model'
import { db } from '../lib/db'
import { speak } from '../lib/speech'
import { previewIntervals, Rating, type Grade } from '@kikitori/core/srs'
import { database, store } from '../lib/store'
import { type GradeUndo } from '@kikitori/core/store'
import { CARD_MODES, cardKey, modeOf, recallPrompt, type CardMode } from '@kikitori/core/review'
import { coreRank, introduceCoreWords, isCoreCard } from '@kikitori/core/coreWords'

const fmtDays = (d: number) => (d < 1 / 24 ? `${Math.max(1, Math.round(d * 1440))}m` : d < 1 ? `${Math.round(d * 24)}h` : `${Math.round(d)}d`)

/** What a card says aloud: the word, or the sentence it is. */
const spokenText = (card: Flashcard) => (card.kind === 'word' ? card.front : card.context || card.front)

function CoreLabel({ card }: { card: Flashcard }) {
  const { t } = useSettings()
  return (
    <p className="card-context muted" data-testid="core-label">
      {t.coreWordLabel(coreRank(card))}
    </p>
  )
}

/** Highlights the saved word inside its context sentence (if it appears as written). */
function Context({ card }: { card: Flashcard }) {
  if (isCoreCard(card)) return <CoreLabel card={card} />
  if (card.kind === 'sentence') return null
  const at = card.context.indexOf(card.front)
  if (at < 0) return <p className="card-context" lang="ja">{card.context}</p>
  return (
    <p className="card-context" lang="ja">
      {card.context.slice(0, at)}
      <mark>{card.front}</mark>
      {card.context.slice(at + card.front.length)}
    </p>
  )
}

/** Read / Listen / Recall / Mix, kept in settings. */
function CardModePicker() {
  const { t, settings, update } = useSettings()
  return (
    <div className="card-mode">
      <div className="segmented" role="group" aria-label={t.cardMode} data-testid="card-mode">
        {CARD_MODES.map((m) => (
          <button key={m} type="button" className="btn" aria-pressed={settings.cardMode === m} data-testid={`card-mode-${m}`} onClick={() => update({ cardMode: m })}>
            {t.cardModes[m]}
          </button>
        ))}
      </div>
      <p className="muted small">{t.cardModeHint}</p>
    </div>
  )
}

/** Keys from text fields and the like are theirs, not shortcuts. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)

/**
 * Controls focused by a click or tap (not by the keyboard). A control reached with the keyboard
 * keeps its own Space and Enter (a keyboard user picks a mode or presses Undo that way); one
 * merely clicked doesn't, and Space still shows the answer. (:focus-visible can't tell: a key
 * pressed on a clicked button makes it match.)
 */
const clicked = new WeakSet<Element>()
/** What the last pointer press landed on, until the focus it brings. */
let pressed: Element | null = null
const ownsSpace = (target: EventTarget | null) =>
  target instanceof Element && !clicked.has(target) && !!target.closest('button, a, [role="button"]') && !target.closest('[data-testid="show-answer"]')

export function Cards() {
  const { t, settings } = useSettings()
  const dict = useDictionary()
  // Load the due queue once: graded cards get future due dates, and a live
  // query would drop them mid-session and throw off the counter.
  const [queue, setQueue] = useState<Flashcard[] | null>(null)
  useEffect(() => {
    // Today's new core words first (a new day may have begun since start-up).
    introduceCoreWords(database, settings.newWordsPerDay).then(() => store.dueCards()).then(setQueue)
    // Loaded once: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // One moment per session, so Mix can't change a card's mode midway.
  const [now] = useState(() => Date.now())
  const [done, setDone] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)
  // This session's grades, latest last, each with what its card was before.
  const [undos, setUndos] = useState<GradeUndo[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const card = queue?.find((c) => !done.has(c.id!))
  // Tagged with its lesson id, to tell "still loading" from "no such lesson".
  const loaded = useLiveQuery(async () => (card ? { lessonId: card.lessonId, lesson: await db.lessons.get(card.lessonId) } : undefined), [card?.lessonId])
  const lessonReady = !!card && loaded?.lessonId === card.lessonId
  const intervals = useMemo(() => (card ? previewIntervals(card.card, new Date()) : null), [card])

  const translation = lessonReady ? loaded.lesson?.sentences.find((s) => s.text === card.context)?.translations?.[settings.lang] : undefined
  const chosen: CardMode | null = card ? modeOf(card, settings.cardMode, now) : null
  // A recall card waits for what it asks with (rather than showing the Japanese, then hiding it);
  // with nothing to ask with, it's read instead. Once answered, everything shows anyway.
  const pending = chosen === 'recall' && !flipped && !!card && (card.kind === 'word' ? dict === undefined : !lessonReady)
  const prompt = chosen === 'recall' && card && !pending ? recallPrompt(card, dict ?? null, translation) : null
  const mode: CardMode | null = chosen === 'recall' && !pending && !prompt ? 'read' : chosen

  const play = () => card && speak(spokenText(card), settings.rate, settings.voiceURI)

  // Listen cards speak once as they appear (and again if one comes back by an undo).
  const autoPlayed = useRef<number | null>(null)
  useEffect(() => {
    if (!card || mode !== 'listen' || flipped || autoPlayed.current === card.id) return
    autoPlayed.current = card.id!
    void speak(spokenText(card), settings.rate, settings.voiceURI)
    // Only a new card (or a switch to Listen) plays; not a change of voice or speed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, mode])

  const grade = async (g: Grade) => {
    if (busy || !card) return
    setBusy(true)
    try {
      const before = await store.gradeCard(card.id!, g)
      if (before) setUndos((u) => [...u, before])
      setDone((d) => new Set(d).add(card.id!))
      setFlipped(false)
      setNotice(null)
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    const last = undos.at(-1)
    if (busy || !last) return
    setBusy(true)
    try {
      // A sync already under way may be sending this grade: once it's done, the store knows
      // whether the server has it (and refuses the undo if so).
      await syncIdle()
      const undone = await store.undoGrade(last)
      setUndos((u) => u.slice(0, -1))
      if (undone) {
        // The queue still holds the card as it was before the grade, so it comes back as restored.
        setDone((d) => {
          const next = new Set(d)
          next.delete(last.id)
          return next
        })
        setFlipped(false)
        autoPlayed.current = null
      }
      setNotice(undone ? t.undone : t.undoSynced)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  // Keyboard shortcuts (Space/Enter, 1–4, R, U). The listener stays put; what a key does
  // depends on the latest render, so it goes through a ref, updated as the render commits (a
  // passive effect can lag behind the screen, and a key pressed meanwhile would act on the
  // card before).
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  useLayoutEffect(() => {
    onKey.current = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      if ((e.key === ' ' || e.key === 'Enter') && ownsSpace(e.target)) return
      const action = cardKey(e.key, flipped)
      // With the answer showing, Space has nothing to do: not scroll the page, nor click the
      // button the mouse last pressed.
      if (action === null && e.key === ' ') e.preventDefault()
      if (action === null) return
      if (action === 'flip') {
        if (!card) return
        setFlipped(true)
      } else if (action === 'play') {
        // Hearing a recall card would give the answer away.
        if (!card || (mode === 'recall' && !flipped)) return
        void play()
      } else if (action === 'undo') {
        if (!undos.length) return
        void undo()
      } else {
        if (!card || busy) return
        void grade(action)
      }
      // Space would scroll the page or click the focused button too.
      e.preventDefault()
    }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e)
    const pointer = (e: PointerEvent) => (pressed = e.target instanceof Element ? e.target : null)
    const focus = (e: FocusEvent) => {
      if (!(e.target instanceof Element)) return
      if (pressed && e.target.contains(pressed)) clicked.add(e.target)
      else clicked.delete(e.target)
      pressed = null
    }
    window.addEventListener('keydown', listener)
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('focusin', focus)
    return () => {
      window.removeEventListener('keydown', listener)
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('focusin', focus)
    }
  }, [])

  // Hold syncing while reviewing, so the last grade stays undoable; let it run while the
  // app is in the background.
  useEffect(() => {
    let release: (() => void) | null = holdSync()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        release?.()
        release = null
      } else if (!release) release = holdSync()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      release?.()
    }
  }, [])

  if (!queue) return null

  const undoButton = undos.length > 0 && (
    <button type="button" className="btn ghost" data-testid="undo" disabled={busy} onClick={undo}>
      {t.undo}
    </button>
  )
  const undoMessage = notice && (
    <p className="muted small" role="status" data-testid="undo-message">
      {notice}
    </p>
  )

  if (!card)
    return (
      <div className="page">
        <div className="page-head">
          <h1>{t.navCards}</h1>
          {undoButton}
        </div>
        {undoMessage}
        <p className="empty">{done.size ? t.cardsDoneToday : t.noCards}</p>
      </div>
    )

  // Before the answer, Listen and Recall hide the Japanese (a core word keeps its label).
  const hideFront = !flipped && (mode === 'listen' || mode === 'recall')

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t.navCards}</h1>
        <div className="card-head-side">
          {undoButton}
          <span className="muted">
            {done.size + 1} {t.of} {queue.length}
          </span>
        </div>
      </div>
      <CardModePicker />
      {undoMessage}
      <div className={`flashcard kind-${card.kind}`} data-testid="flashcard">
        {pending ? null : hideFront ? (
          <>
            <div className="card-prompt" data-testid="card-prompt">
              <p className="muted">{mode === 'listen' ? t.listenPrompt : t.recallPrompt}</p>
              {prompt &&
                (card.kind === 'word' ? (
                  <ol>
                    {prompt.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="translation">{prompt[0]}</p>
                ))}
            </div>
            {isCoreCard(card) && <CoreLabel card={card} />}
          </>
        ) : (
          <>
            <div className="card-front" lang="ja">
              {card.front}
            </div>
            <Context card={card} />
          </>
        )}
        {flipped && (
          <div className="card-back" data-testid="card-back">
            <div className="card-reading" lang="ja">
              {card.reading}
            </div>
            {card.kind === 'word' && <PitchAccent word={card.front} reading={card.reading} />}
            {card.kind === 'word' && <Meanings word={card.front} reading={card.reading} />}
            {translation && <p className="translation">{translation}</p>}
            {card.kind === 'word' && <ExampleSentences word={card.front} reading={card.reading} />}
          </div>
        )}
        {!pending && (flipped || mode !== 'recall') && (
          <button type="button" className="btn ghost" data-testid="play-card" onClick={play}>
            <Icon name="play" /> {t.play}
          </button>
        )}
      </div>
      <VoiceCredit />
      {flipped ? (
        <div className="grades">
          {(
            [
              [Rating.Again, t.again],
              [Rating.Hard, t.hard],
              [Rating.Good, t.good],
              [Rating.Easy, t.easy],
            ] as [Grade, string][]
          ).map(([g, label]) => (
            <button key={g} type="button" className={`btn grade-btn g${g}`} data-testid={`grade-${g}`} disabled={busy} onClick={() => grade(g)}>
              {label}
              <small>{intervals && fmtDays(intervals[g])}</small>
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="btn primary big wide" data-testid="show-answer" onClick={() => setFlipped(true)}>
          {t.showAnswer}
        </button>
      )}
      <p className="card-keys muted small">{t.cardKeys}</p>
    </div>
  )
}
