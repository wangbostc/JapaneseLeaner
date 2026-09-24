import { useState } from 'react'
import { useSettings } from '../app/settings'
import { speak } from '../lib/speech'
import { store } from '../lib/store'
import type { Token } from '../lib/tokenizer'
import { Icon } from './Icon'

interface Props {
  token: Token
  lessonId: number
  context: string
  analyzerReading: (text: string) => string
  onClose: () => void
}

/** Bottom sheet for a tapped word: hear it, save it as a flashcard in context. */
export function WordSheet({ token, lessonId, context, analyzerReading, onClose }: Props) {
  const { t, settings } = useSettings()
  const [saved, setSaved] = useState(false)
  const save = async () => {
    await store.addCard({ lessonId, kind: 'word', front: token.lemma, reading: analyzerReading(token.lemma), context })
    setSaved(true)
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={token.lemma} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-word" lang="ja">
          {token.lemma}
          <span className="sheet-reading">{analyzerReading(token.lemma)}</span>
        </div>
        {token.surface !== token.lemma && (
          <div className="muted" lang="ja">
            {token.surface} · {token.pos}
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={() => speak(token.lemma, settings.rate, settings.voiceURI)}>
            <Icon name="play" /> {t.play}
          </button>
          <button className="btn primary" onClick={save} disabled={saved}>
            <Icon name={saved ? 'check' : 'star'} /> {saved ? t.saved : t.saveWord}
          </button>
        </div>
      </div>
    </div>
  )
}
