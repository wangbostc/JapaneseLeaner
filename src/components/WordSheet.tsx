import { useEffect, useRef, useState } from 'react'
import { VoiceCredit } from './VoiceCredit'
import { useSettings } from '../app/useSettings'
import { speak } from '../lib/speech'
import { store } from '../lib/store'
import type { Token } from '../lib/tokenizer'
import { Icon } from './Icon'
import { Meanings } from './Meanings'
import { PitchAccent } from './PitchAccent'

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
  const saveButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    saveButton.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [onClose])
  const save = async () => {
    await store.addCard({ lessonId, kind: 'word', front: token.lemma, reading: analyzerReading(token.lemma), context })
    setSaved(true)
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={token.lemma} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-word" lang="ja">
          {token.lemma}
          <span className="sheet-reading">{analyzerReading(token.lemma)}</span>
        </div>
        {token.surface !== token.lemma && (
          <div className="muted" lang="ja">
            {token.surface} · {token.pos}
          </div>
        )}
        <PitchAccent word={token.lemma} reading={analyzerReading(token.lemma)} pos={token.pos} />
        <Meanings word={token.lemma} reading={analyzerReading(token.lemma)} />
        <div className="row">
          <button className="btn" onClick={() => speak(token.lemma, settings.rate, settings.voiceURI)}>
            <Icon name="play" /> {t.play}
          </button>
          <button ref={saveButton} className="btn primary" onClick={save} disabled={saved}>
            <Icon name={saved ? 'check' : 'star'} /> {saved ? t.saved : t.saveWord}
          </button>
        </div>
        <VoiceCredit />
      </div>
    </div>
  )
}
