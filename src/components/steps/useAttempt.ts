import { useEffect, useRef, useState } from 'react'
import { listen, record, recognitionSupported, recordingSupported, type Listening, type Recording } from '../../lib/speech'

export type AttemptPhase = 'idle' | 'recording' | 'done'

/**
 * One spoken attempt: records the mic (for playback) and runs speech
 * recognition (for scoring), each only where the browser supports it.
 */
export function useAttempt() {
  const [phase, setPhase] = useState<AttemptPhase>('idle')
  const [interim, setInterim] = useState('')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recording | null>(null)
  const heard = useRef<Listening | null>(null)
  const canScore = recognitionSupported()

  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl])

  const start = async () => {
    setError(null)
    setInterim('')
    setTranscript(null)
    setAudioUrl(null)
    try {
      if (recordingSupported() && !window.__kikitoriFake) rec.current = await record()
      if (canScore) heard.current = listen(setInterim)
      setPhase('recording')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  const stop = async () => {
    const listening = heard.current
    listening?.stop()
    const [blob, text] = await Promise.all([
      rec.current?.stop() ?? null,
      listening?.result.catch((e: Error) => {
        setError(e.message)
        return ''
      }) ?? null,
    ])
    rec.current = null
    heard.current = null
    if (blob) setAudioUrl(URL.createObjectURL(blob))
    setTranscript(text)
    setPhase('done')
  }

  const reset = () => {
    setPhase('idle')
    setTranscript(null)
    setInterim('')
    setAudioUrl(null)
  }

  return { phase, interim, transcript, audioUrl, error, canScore, start, stop, reset }
}
