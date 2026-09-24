import { useEffect, useRef, useState } from 'react'
import { useAiKey } from '../app/aiKey'
import { useSettings } from '../app/useSettings'
import type { AiErrorCode } from '../lib/ai'

/** "Explain" button that streams an AI explanation of the sentence; hidden without an API key. */
export function ExplainPanel({ sentence, context }: { sentence: string; context: string[] }) {
  const { t, settings } = useSettings()
  const key = useAiKey()
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<AiErrorCode | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  if (!key) return null

  const run = async () => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setText('')
    setError(null)
    setState('loading')
    // Loaded on demand: learners without a key never download the SDK.
    const ai = await import('../lib/ai')
    try {
      await ai.explainSentence(ai.createAiClient(key), {
        sentence,
        lang: settings.lang,
        context,
        signal: ctrl.signal,
        onText: (chunk) => setText((prev) => prev + chunk),
      })
      if (!ctrl.signal.aborted) setState('done')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(ai.aiErrorCode(e))
      setState('error')
    }
  }

  return (
    <div className="explain">
      {state !== 'idle' && (
        <div className="explain-body" role="status" aria-live="polite" data-testid="explanation">
          {text || (state === 'loading' && <span className="muted">{t.explaining}</span>)}
          {error && <p className="error">{t.aiErrors[error]}</p>}
        </div>
      )}
      {state !== 'loading' && (
        <button className="btn ghost" onClick={run}>
          ✦ {state === 'idle' ? t.explain : t.retry}
        </button>
      )}
    </div>
  )
}
