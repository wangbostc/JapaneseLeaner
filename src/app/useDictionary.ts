import { useEffect, useState } from 'react'
import { type Examples } from '@kikitori/core/examples'
import { type Dictionary } from '@kikitori/core/jmdict'
import { getDictionary, getExamples } from '../lib/jmdict'

/** undefined while loading, null if the dictionary isn't available. */
export function useDictionary(): Dictionary | null | undefined {
  const [dict, setDict] = useState<Dictionary | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    getDictionary().then((d) => live && setDict(d))
    return () => {
      live = false
    }
  }, [])
  return dict
}

/** Example sentences: undefined while loading, null if they aren't available. */
export function useExamples(): Examples | null | undefined {
  const [examples, setExamples] = useState<Examples | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    getExamples().then((e) => live && setExamples(e))
    return () => {
      live = false
    }
  }, [])
  return examples
}
