import { pitchPattern } from '@kikitori/core/pitch'
import { useApp, useResource } from '../context'
import { Row, Text } from './primitives'
import { C } from './theme'

/** The word's pitch: a line over high morae, a step down where pitch falls, and a faint が. */
export function PitchAccent({ word, reading, pos }: { word: string; reading: string; pos?: string }) {
  const { t, accents } = useApp()
  const table = useResource(accents)
  if (!table) return null
  const types = table.lookup(word, reading, pos)
  const pitch = types?.length ? pitchPattern(reading, types[0]) : null
  if (!pitch) return null
  const mora = (m: string, high: boolean, drop: boolean, faint = false) => (
    <div
      style={{
        display: 'flex',
        paddingLeft: 1,
        paddingRight: 1,
        borderColor: faint ? C.faint : C.ruby,
        ...(high ? { borderTopWidth: 2 } : { borderBottomWidth: 2 }),
        ...(drop ? { borderRightWidth: 2 } : {}),
      }}
    >
      <Text size={18} ja color={faint ? C.faint : C.text}>
        {m}
      </Text>
    </div>
  )
  return (
    <Row testId="pitch" style={{ gap: 12, alignItems: 'center' }}>
      <Row>
        {pitch.morae.map((m, i) => (
          <Row key={i}>{mora(m, pitch.high[i], pitch.dropAfter === i)}</Row>
        ))}
        {mora('が', pitch.particleHigh, false, true)}
      </Row>
      <Text size={12} color={C.dim}>
        {`${t.pitchNames[pitch.name]} [${pitch.aType}]${types!.length > 1 ? ` · ${t.pitchAlso} ${types!.slice(1).join(', ')}` : ''}`}
      </Text>
    </Row>
  )
}
