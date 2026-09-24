import { useState } from 'react'
import { useSettings } from '../../app/useSettings'
import { Icon } from '../Icon'
import type { StepProps } from './types'

/** The whole passage, no text: a check on real-speed comprehension. */
export function Blind({ lesson, player, onDone }: StepProps) {
  const { t, settings } = useSettings()
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(-1)
  const [played, setPlayed] = useState(false)
  const [little, setLittle] = useState(false)

  const play = async () => {
    if (playing) {
      player.stop()
      setPlaying(false)
      return
    }
    setPlaying(true)
    setLittle(false)
    await player.playAll(lesson.sentences, settings.rate, setCurrent)
    setPlaying(false)
    setCurrent(-1)
    setPlayed(true)
  }

  return (
    <div className="step">
      <div className="blind-stage">
        <button className={`btn big-play ${playing ? 'live' : ''}`} onClick={play} aria-label={playing ? t.stop : t.play}>
          <Icon name={playing ? 'pause' : 'play'} size={44} />
        </button>
        <div className="dots" aria-hidden="true">
          {lesson.sentences.map((_, k) => (
            <span key={k} className={k === current ? 'on' : k < current ? 'past' : ''} />
          ))}
        </div>
      </div>
      {played && !playing && (
        <div className="self-rate">
          <p>{t.blindQuestion}</p>
          <div className="row">
            <button className="btn" onClick={onDone}>{t.blindAll}</button>
            <button className="btn" onClick={onDone}>{t.blindGist}</button>
            <button className="btn" onClick={() => setLittle(true)}>{t.blindLittle}</button>
          </div>
          {little && (
            <p className="muted">
              {t.blindLittleHint}{' '}
              <button className="link" onClick={onDone}>
                {t.next} →
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
