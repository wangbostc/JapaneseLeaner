import { useEffect, useState } from 'react'
import { useSettings } from '../../app/useSettings'
import { readingOf } from '../../lib/scoring'
import { store } from '../../lib/store'
import type { Token } from '../../lib/tokenizer'
import { ExplainPanel } from '../ExplainPanel'
import { Icon } from '../Icon'
import { JapaneseText } from '../JapaneseText'
import { WordSheet } from '../WordSheet'
import type { StepProps } from './types'

/** Sentence by sentence: listen until it's clear, then check against the text. */
export function Intensive(props: StepProps) {
  const i = Math.min(props.position, props.lesson.sentences.length - 1)
  // Keyed by sentence so per-sentence state (revealed, saved) starts fresh.
  return <IntensiveSentence key={i} {...props} i={i} />
}

function IntensiveSentence({ lesson, analyzer, player, onPosition, onDone, i }: StepProps & { i: number }) {
  const { t, settings } = useSettings()
  const [revealed, setRevealed] = useState(false)
  const [word, setWord] = useState<Token | null>(null)
  const [savedSentence, setSavedSentence] = useState(false)
  const s = lesson.sentences[i]
  const hard = lesson.hard.includes(i)
  const last = i === lesson.sentences.length - 1

  useEffect(() => {
    player.play(s, settings.rate)
    return () => player.stop()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- play once per sentence

  const saveSentence = async () => {
    await store.addCard({ lessonId: lesson.id, kind: 'sentence', front: s.text, reading: readingOf(analyzer, s.text), context: s.text })
    setSavedSentence(true)
  }

  return (
    <div className="step">
      <div className="counter">
        {i + 1} {t.of} {lesson.sentences.length}
      </div>
      <div className={`sentence-card ${revealed ? '' : 'concealed'}`}>
        {revealed ? (
          <>
            <JapaneseText
              className="jp-large"
              text={s.text}
              analyzer={analyzer}
              furigana={settings.furigana}
              onWord={setWord}
              chunked={settings.chunks}
              onPlayGroup={lesson.mediaId ? undefined : (text) => player.play({ start: null, end: null, text }, settings.rate)}
              playLabel={t.playChunk}
              uiLang={settings.lang}
            />
            {settings.translation && s.translations?.[settings.lang] && <p className="translation">{s.translations[settings.lang]}</p>}
            <ExplainPanel sentence={s.text} context={lesson.sentences.map((x) => x.text)} />
          </>
        ) : (
          <button className="conceal" onClick={() => setRevealed(true)} aria-label={t.reveal}>
            {'・'.repeat(Math.min(s.text.length, 24))}
          </button>
        )}
      </div>
      <div className="controls">
        <button className="btn round" onClick={() => player.play(s, settings.rate)} aria-label={t.replay}>
          <Icon name="replay" size={24} />
          <span>{t.replay}</span>
        </button>
        <button className="btn round" onClick={() => player.play(s, settings.rate * 0.7)} aria-label={t.slow}>
          <Icon name="slow" size={24} />
          <span>{t.slow}</span>
        </button>
        <button className="btn round" onClick={() => setRevealed((r) => !r)} aria-pressed={revealed}>
          <Icon name="eye" size={24} />
          <span>{revealed ? t.hide : t.reveal}</span>
        </button>
        <button className={`btn round ${hard ? 'hard-on' : ''}`} onClick={() => store.setHard(lesson.id, i, !hard)} aria-pressed={hard}>
          <Icon name="flag" size={24} />
          <span>{t.markHard}</span>
        </button>
        <button className="btn round" onClick={saveSentence} disabled={savedSentence}>
          <Icon name={savedSentence ? 'check' : 'star'} size={24} />
          <span>{savedSentence ? t.saved : t.saveSentence}</span>
        </button>
      </div>
      <div className="nav-row">
        <button className="btn ghost" disabled={i === 0} onClick={() => onPosition(i - 1)}>
          <Icon name="back" /> {t.back}
        </button>
        <button className="btn primary" onClick={() => (last ? onDone() : onPosition(i + 1))}>
          {last ? t.finishStep : t.next} <Icon name="next" />
        </button>
      </div>
      {word && (
        <WordSheet token={word} lessonId={lesson.id} context={s.text} analyzerReading={(x) => readingOf(analyzer, x)} onClose={() => setWord(null)} />
      )}
    </div>
  )
}
