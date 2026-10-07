import { useApp, useResource } from '../context'
import { Col, Text } from './primitives'
import { C } from './theme'

/** JMdict meanings for a dictionary form; nothing if the dictionary is unavailable. */
export function Meanings({ word, reading }: { word: string; reading?: string }) {
  const { t, dictionary } = useApp()
  const dict = useResource(dictionary)
  if (!dict) return null
  const entries = dict.lookup(word, reading)
  if (!entries.length) return <Text color={C.dim}>{t.noMeaning}</Text>
  return (
    <Col testId="meanings" style={{ gap: 4 }}>
      {entries[0].senses.map((s, i) => (
        <Text key={i}>{`${i + 1}. ${s.glosses.join('; ')}${s.pos.length ? ` · ${s.pos.map(dict.describePos).join(', ')}` : ''}`}</Text>
      ))}
      {entries.length > 1 && (
        <Text size={12} color={C.dim} ja>
          {entries
            .slice(1)
            .map((e) => `${e.kanji[0] ?? e.kana[0]}（${e.kana[0]}）${e.senses[0]?.glosses[0] ?? ''}`)
            .join(' / ')}
        </Text>
      )}
      <Text size={11} color={C.faint}>
        {t.meaningsNote}
      </Text>
    </Col>
  )
}
