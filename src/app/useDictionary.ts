import { useEffect, useState } from 'react'
import { type Dictionary } from '@kikitori/core/jmdict'
import { getDictionary } from '../lib/jmdict'

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
