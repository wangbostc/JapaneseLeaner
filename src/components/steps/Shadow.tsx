import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../../app/useSettings'
import { gradeFor, readingOf, scoreShadowing, type ShadowingResult } from '../../lib/scoring'
import { store } from '../../lib/store'
import { Icon } from '../Icon'
import { JapaneseText } from '../JapaneseText'
import type { StepProps } from './types'
import { useAttempt } from './useAttempt'

interface Props extends StepProps {
  /** Sentence indices to drill, in order. */
  indices: number[]
  /** 'hard' drills graduate a sentence out of the hard set once it scores A or better. */
  mode: 'shadow' | 'hard'
}

const SELF_RATE_SCORE = { good: 90, ok: 65, bad: 30 } as const

export function Shadow(props: Props) {
  const p = Math.min(props.position, props.indices.length - 1)
  // Keyed by position so each sentence starts with a fresh attempt.
  return <ShadowSentence key={p} {...props} p={p} />
}

function ShadowSentence({ lesson, analyzer, player, onPosition, onDone, indices, mode, p }: Props & { p: number }) {
  const { t, settings } = useSettings()
  const attempt = useAttempt()
  const [selfRated, setSelfRated] = useState<ShadowingResult | null>(null)
  const i = indices[p]
  const s = lesson.sentences[i]
  const last = p === indices.length - 1

  useEffect(() => {
    player.play(s, settings.rate)
    return () => player.stop()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- play once per sentence

  const scored = useMemo(
    () =>
      attempt.phase === 'done' && attempt.transcript
        ? scoreShadowing(readingOf(analyzer, s.text), readingOf(analyzer, attempt.transcript))
        : null,
    [analyzer, s.text, attempt.phase, attempt.transcript],
  )
  const result = scored ?? selfRated

  // A weak attempt puts the sentence in the hard set; a strong one in the drill takes it out.
  useEffect(() => {
    if (!result) return
    if (result.grade === 'C') store.setHard(lesson.id, i, true)
    else if (mode === 'hard' && result.score >= 75) store.setHard(lesson.id, i, false)
  }, [result, lesson.id, i, mode])

  const selfRate = (k: keyof typeof SELF_RATE_SCORE) => {
    const score = SELF_RATE_SCORE[k]
    setSelfRated({ score, grade: gradeFor(score), marks: [] })
  }

  const needsSelfRate = attempt.phase === 'done' && !result && (!attempt.canScore || !attempt.transcript)

  return (
    <div className="step">
      <div className="counter">
        {p + 1} {t.of} {indices.length}
        {lesson.hard.includes(i) && <span className="pill hard">{t.markHard}</span>}
      </div>
      <div className="sentence-card">
        <JapaneseText className="jp-large" text={s.text} analyzer={analyzer} furigana={settings.furigana} />
        {settings.translation && s.translations?.[settings.lang] && <p className="translation">{s.translations[settings.lang]}</p>}
      </div>

      {result && (
        <div className={`result grade-${result.grade}`} data-testid="shadow-result" role="status" aria-live="polite">
          <div className="grade">{result.grade}</div>
          <div>
            <div className="score">{result.score}</div>
            {result.marks.length > 0 && (
              <div className="marks" lang="ja">
                {result.marks.map((m, k) => (
                  <span key={k} className={m.hit ? 'hit' : 'miss'}>
                    {m.char}
                  </span>
                ))}
              </div>
            )}
            {attempt.transcript && (
              <div className="muted heard" lang="ja">
                「{attempt.transcript}」
              </div>
            )}
          </div>
        </div>
      )}
      {attempt.error && <p className="error">{attempt.error}</p>}
      {attempt.phase === 'recording' && <p className="interim" lang="ja" aria-live="polite">{attempt.interim || t.listening}</p>}
      {needsSelfRate && (
        <div className="self-rate">
          <p>{attempt.canScore ? t.selfRate : t.noRecognition}</p>
          <div className="row">
            <button className="btn" onClick={() => selfRate('good')}>{t.rateGood}</button>
            <button className="btn" onClick={() => selfRate('ok')}>{t.rateOk}</button>
            <button className="btn" onClick={() => selfRate('bad')}>{t.rateBad}</button>
          </div>
        </div>
      )}
      {attempt.audioUrl && (
        <div className="attempt-audio">
          <span className="muted">{t.yourAttempt}</span>
          <audio controls src={attempt.audioUrl} />
        </div>
      )}

      <div className="controls">
        <button className="btn round" onClick={() => player.play(s, settings.rate)} disabled={attempt.busy}>
          <Icon name="replay" size={24} />
          <span>{t.replay}</span>
        </button>
        {attempt.phase === 'recording' ? (
          <button className="btn round mic live" onClick={attempt.stop}>
            <Icon name="stop" size={28} />
            <span>{t.stop}</span>
          </button>
        ) : (
          <button
            className="btn round mic"
            disabled={attempt.phase === 'starting'}
            onClick={() => {
              player.stop()
              setSelfRated(null)
              attempt.start()
            }}
          >
            <Icon name="mic" size={28} />
            <span>{attempt.phase === 'done' ? t.tryAgain : t.record}</span>
          </button>
        )}
      </div>
      <div className="nav-row">
        <button className="btn ghost" disabled={p === 0 || attempt.busy} onClick={() => onPosition(p - 1)}>
          <Icon name="back" /> {t.back}
        </button>
        <button className="btn primary" disabled={attempt.busy} onClick={() => (last ? onDone() : onPosition(p + 1))}>
          {last ? t.finishStep : t.next} <Icon name="next" />
        </button>
      </div>
    </div>
  )
}
