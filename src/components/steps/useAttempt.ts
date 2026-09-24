import { useEffect, useRef, useState } from 'react'
import { listen, record, recognitionSupported, recordingSupported, type Listening, type Recording } from '../../lib/speech'

export type AttemptPhase = 'idle' | 'starting' | 'recording' | 'done'

/**
 * One spoken attempt: records the mic (for playback) and runs speech
 * recognition (for scoring), each only where the browser supports it.
 * The mic is always released: on stop, on cancel, and on unmount.
 */
export function useAttempt() {
  const [phase, setPhase] = useState<AttemptPhase>('idle')
  const [interim, setInterim] = useState('')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recording | null>(null)
  const heard = useRef<Listening | null>(null)
  const stopping = useRef<Promise<void> | null>(null)
  const alive = useRef(true)
  /** Bumped by every start and cancel; a start that finds it changed after awaiting the mic backs out. */
  const generation = useRef(0)
  const canScore = recognitionSupported()

  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl])

  /** Release the mic and recogniser without producing a result. */
  const cancel = () => {
    generation.current++
    heard.current?.stop()
    heard.current = null
    rec.current?.stop()
    rec.current = null
    stopping.current = null
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      cancel()
    }
  }, [])

  const stop = () => {
    stopping.current ??= (async () => {
      const listening = heard.current
      const recording = rec.current
      listening?.stop()
      const [blob, text] = await Promise.all([
        recording?.stop() ?? null,
        listening?.result.catch((e: Error) => {
          if (alive.current) setError(e.message)
          return ''
        }) ?? null,
      ])
      rec.current = null
      heard.current = null
      stopping.current = null
      if (!alive.current) return
      if (blob) setAudioUrl(URL.createObjectURL(blob))
      setTranscript(text)
      setPhase('done')
    })()
    return stopping.current
  }

  const start = async () => {
    if (phase === 'starting' || phase === 'recording') return
    cancel()
    const mine = generation.current
    setError(null)
    setInterim('')
    setTranscript(null)
    setAudioUrl(null)
    setPhase('starting')
    try {
      // Awaiting mic permission can take a while; the learner may leave meanwhile.
      const recording = recordingSupported() && !window.__kikitoriFake ? await record() : null
      if (!alive.current || generation.current !== mine) {
        recording?.stop()
        return
      }
      rec.current = recording
      if (canScore) {
        const listening = listen(setInterim)
        heard.current = listening
        // Browsers end recognition on their own after a silence; finish the attempt then too.
        const endedByBrowser = () => {
          if (heard.current === listening) void stop()
        }
        listening.result.then(endedByBrowser, endedByBrowser)
      }
      setPhase('recording')
    } catch (e) {
      if (!alive.current || generation.current !== mine) return
      cancel()
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  /** True while the mic is being opened or is live: navigation should wait. */
  const busy = phase === 'starting' || phase === 'recording'

  return { phase, busy, interim, transcript, audioUrl, error, canScore, start, stop }
}
