import { useEffect, useState } from 'react'
import { useSettings } from '../../app/settings'
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

export function Shadow({ lesson, analyzer, player, position, onPosition, onDone, indices, mode }: Props) {
  const { t, settings } = useSettings()
  const attempt = useAttempt()
  const [result, setResult] = useState<ShadowingResult | null>(null)
  const p = Math.min(position, indices.length - 1)
  const i = indices[p]
  const s = lesson.sentences[i]
  const last = p === indices.length - 1

  useEffect(() => {
    attempt.reset()
    setResult(null)
    player.play(s, settings.rate)
    return () => player.stop()
  }, [p]) // eslint-disable-line react-hooks/exhaustive-deps

  const settle = (score: number) => {
    // A weak attempt puts the sentence in the hard set; a strong one in the drill takes it out.
    if (gradeFor(score) === 'C') store.setHard(lesson.id, i, true)
    else if (mode === 'hard' && score >= 75) store.setHard(lesson.id, i, false)
  }

  useEffect(() => {
    if (attempt.phase !== 'done' || attempt.transcript === null) return
    const r = scoreShadowing(readingOf(analyzer, s.text), readingOf(analyzer, attempt.transcript))
    setResult(r)
    settle(r.score)
  }, [attempt.phase, attempt.transcript]) // eslint-disable-line react-hooks/exhaustive-deps

  const selfRate = (k: keyof typeof SELF_RATE_SCORE) => {
    const score = SELF_RATE_SCORE[k]
    setResult({ score, grade: gradeFor(score), marks: [] })
    settle(score)
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
        <div className={`result grade-${result.grade}`} data-testid="shadow-result">
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
      {attempt.phase === 'recording' && <p className="interim" lang="ja">{attempt.interim || t.listening}</p>}
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
        <button className="btn round" onClick={() => player.play(s, settings.rate)} disabled={attempt.phase === 'recording'}>
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
            onClick={() => {
              player.stop()
              setResult(null)
              attempt.start()
            }}
          >
            <Icon name="mic" size={28} />
            <span>{attempt.phase === 'done' ? t.tryAgain : t.record}</span>
          </button>
        )}
      </div>
      <div className="nav-row">
        <button className="btn ghost" disabled={p === 0} onClick={() => onPosition(p - 1)}>
          <Icon name="back" /> {t.back}
        </button>
        <button className="btn primary" disabled={attempt.phase === 'recording'} onClick={() => (last ? onDone() : onPosition(p + 1))}>
          {last ? t.finishStep : t.next} <Icon name="next" />
        </button>
      </div>
    </div>
  )
}
