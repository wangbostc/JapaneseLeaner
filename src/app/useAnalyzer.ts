import { useEffect, useState } from 'react'
import { getAnalyzer, type Analyzer } from '../lib/tokenizer'

export type AnalyzerState = { status: 'loading' } | { status: 'ready'; analyzer: Analyzer } | { status: 'error'; error: Error }

export function useAnalyzer(): AnalyzerState {
  const [state, setState] = useState<AnalyzerState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    getAnalyzer().then(
      (analyzer) => live && setState({ status: 'ready', analyzer }),
      (error: Error) => live && setState({ status: 'error', error }),
    )
    return () => {
      live = false
    }
  }, [])
  return state
}
