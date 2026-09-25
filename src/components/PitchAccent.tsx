import { useEffect, useState } from 'react'
import { useSettings } from '../app/useSettings'
import { getAccentTable, pitchPattern, type AccentTable } from '../lib/pitch'

/**
 * The word's dictionary-form pitch: an overline over high morae, a step down where
 * pitch falls, and a faint が showing whether a following particle stays high.
 */
export function PitchAccent({ word, reading, pos }: { word: string; reading: string; pos?: string }) {
  const { t } = useSettings()
  const [table, setTable] = useState<AccentTable | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    getAccentTable().then((a) => live && setTable(a))
    return () => {
      live = false
    }
  }, [])
  if (!table) return null
  const types = table.lookup(word, reading, pos)
  const pitch = types?.length ? pitchPattern(reading, types[0]) : null
  if (!pitch) return null
  return (
    <div className="pitch" data-testid="pitch">
      <span className="pitch-word" lang="ja" aria-label={`${t.pitchNames[pitch.name]} [${pitch.aType}]`}>
        {pitch.morae.map((m, i) => (
          <span key={i} className={`mora ${pitch.high[i] ? 'hi' : 'lo'} ${pitch.dropAfter === i ? 'drop' : ''}`}>
            {m}
          </span>
        ))}
        <span className={`mora particle ${pitch.particleHigh ? 'hi' : 'lo'}`}>が</span>
      </span>
      <span className="muted small">
        {t.pitchNames[pitch.name]} [{pitch.aType}]
        {types!.length > 1 && ` · ${t.pitchAlso} ${types!.slice(1).join(', ')}`}
      </span>
    </div>
  )
}
