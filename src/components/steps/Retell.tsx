import { useMemo, useState } from 'react'
import { useSettings } from '../../app/settings'
import { contentLemmas, gradeFor, readingOf, scoreRetell, type RetellResult } from '../../lib/scoring'
import { Icon } from '../Icon'
import type { StepProps } from './types'
import { useAttempt } from './useAttempt'

/** Say the passage back in your own words, prompted by its key words. */
export function Retell({ lesson, analyzer, player, onDone }: StepProps) {
  const { t, settings } = useSettings()
  const attempt = useAttempt()
  const [playing, setPlaying] = useState(false)
  const passage = lesson.sentences.map((s) => s.text).join('')
  // Every content word is shown, since every one counts towards coverage.
  const keywords = useMemo(() => [...contentLemmas(analyzer.tokenize(passage))], [analyzer, passage])
  const result: RetellResult | null = useMemo(
    () => (attempt.phase === 'done' && attempt.transcript ? scoreRetell(analyzer, passage, attempt.transcript) : null),
    [analyzer, passage, attempt.phase, attempt.transcript],
  )
  const missed = new Set(result?.missed)

  const listenAgain = async () => {
    setPlaying(true)
    await player.playAll(lesson.sentences, settings.rate)
    setPlaying(false)
  }

  return (
    <div className="step">
      <h3 className="section-label">{t.keyWords}</h3>
      <div className="chips" lang="ja">
        {keywords.map((w) => (
          <span key={w} className={`chip ${result ? (missed.has(w) ? 'miss' : 'hit') : ''}`}>
            {w}
            {settings.furigana && readingOf(analyzer, w) !== w && <small>{readingOf(analyzer, w)}</small>}
          </span>
        ))}
      </div>

      {attempt.phase === 'recording' && <p className="interim" lang="ja">{attempt.interim || t.listening}</p>}
      {result && (
        <div className={`result grade-${gradeFor(result.coverage)}`} data-testid="retell-result">
          <div className="grade">{result.coverage}%</div>
          <div>
            <div>{t.coverage(result.coverage)}</div>
            <div className="muted heard" lang="ja">「{attempt.transcript}」</div>
          </div>
        </div>
      )}
      {attempt.phase === 'done' && !result && (
        <div className="self-rate">
          <p>{attempt.canScore ? t.selfRate : t.noRecognition}</p>
          <div className="row">
            <button className="btn" onClick={onDone}>{t.rateGood}</button>
            <button className="btn" onClick={onDone}>{t.rateOk}</button>
            <button className="btn" onClick={onDone}>{t.rateBad}</button>
          </div>
        </div>
      )}
      {attempt.audioUrl && (
        <div className="attempt-audio">
          <span className="muted">{t.yourAttempt}</span>
          <audio controls src={attempt.audioUrl} />
        </div>
      )}
      {attempt.error && <p className="error">{attempt.error}</p>}

      <div className="controls">
        <button className="btn round" onClick={listenAgain} disabled={playing || attempt.phase === 'recording'}>
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
              attempt.start()
            }}
          >
            <Icon name="mic" size={28} />
            <span>{attempt.phase === 'done' ? t.tryAgain : t.record}</span>
          </button>
        )}
      </div>
      <div className="nav-row end">
        <button className="btn primary" disabled={attempt.phase === 'recording'} onClick={onDone}>
          {t.finishStep} <Icon name="next" />
        </button>
      </div>
    </div>
  )
}
