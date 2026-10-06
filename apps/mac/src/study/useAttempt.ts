import { useEffect, useRef, useState } from 'react'
import type { Listening } from '../audio/audio'
import { useApp } from '../context'

export type AttemptPhase = 'idle' | 'starting' | 'recording' | 'done'

/**
 * One spoken attempt, as in the web app: the microphone is recognised live and recorded. The
 * phase turns to 'recording' only once the mic is really open (so "speak now" is true), and
 * the mic is always released: on stop, on cancel and on unmount.
 */
export function useAttempt() {
  const { audio } = useApp()
  const [phase, setPhase] = useState<AttemptPhase>('idle')
  const [interim, setInterim] = useState('')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [recording, setRecording] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canScore, setCanScore] = useState(true)
  const listening = useRef<Listening | null>(null)
  const stopping = useRef<Promise<void> | null>(null)
  const alive = useRef(true)
  /** Bumped by every start and cancel; a start that finds it changed after awaiting backs out. */
  const generation = useRef(0)

  const cancel = () => {
    generation.current++
    listening.current?.cancel()
    listening.current = null
    stopping.current = null
  }

  useEffect(() => {
    alive.current = true
    audio.status().then((s) => alive.current && setCanScore(s.canScore), () => alive.current && setCanScore(false))
    return () => {
      alive.current = false
      cancel()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [audio])

  const stop = () => {
    stopping.current ??= (async () => {
      const current = listening.current
      if (!current) return
      let heard = { text: '', recording: null as string | null }
      try {
        heard = await current.stop()
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e))
      }
      listening.current = null
      stopping.current = null
      if (!alive.current) return
      setRecording(heard.recording)
      setTranscript(heard.text)
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
    setRecording(null)
    setPhase('starting')
    const current = audio.listen((text) => alive.current && generation.current === mine && setInterim(text))
    listening.current = current
    try {
      // Opening the mic (and asking permission the first time) takes a moment; the learner may leave.
      await current.started
      if (!alive.current || generation.current !== mine) return
      setPhase('recording')
    } catch (e) {
      if (!alive.current || generation.current !== mine) return
      cancel()
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  /** True while the mic is being opened or is live: navigation waits. */
  const busy = phase === 'starting' || phase === 'recording'
  return { phase, busy, interim, transcript, recording, error, canScore, start, stop }
}
