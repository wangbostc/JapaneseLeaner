import { formRange } from '@kikitori/core/examples'
import { useApp, useResource } from '../context'
import { JapaneseText } from './JapaneseText'
import { Button, Col, Row, Text } from './primitives'
import { C } from './theme'

/**
 * Example sentences for a word (from JMdict, which takes them from Tatoeba), each with its word
 * marked, its translation and its Tatoeba number. Nothing for a word without any.
 */
export function ExampleSentences({ word, reading }: { word: string; reading?: string }) {
  const { t, settings, analyzer, audio, dictionary, examples } = useApp()
  const dict = useResource(dictionary)
  const all = useResource(examples)
  const entry = dict?.lookup(word, reading)[0]
  const found = entry && all ? all.of(entry) : []
  if (!found.length) return null
  return (
    <Col testId="examples" style={{ gap: 10, paddingTop: 6 }}>
      <Text size={12} color={C.dim} weight={600}>
        {t.examples.toUpperCase()}
      </Text>
      {found.map((e, k) => (
        <Col key={e.tatoebaId} testId="example" style={{ gap: 3 }}>
          <Row style={{ gap: 8, alignItems: 'flex-start' }}>
            <Col style={{ flexShrink: 1 }}>
              <JapaneseText text={e.ja} analyzer={analyzer} furigana={settings.furigana} size={17} testIdPrefix={`example-${k}`} mark={formRange(e)} />
            </Col>
            <Button testId={`play-example-${k}`} label="▶" variant="ghost" onPress={() => void audio.speak(e.ja, settings.rate)} />
          </Row>
          <Text color={C.dim}>{e.en}</Text>
          <Text size={11} color={C.faint}>
            {t.exampleSource(e.tatoebaId)}
          </Text>
        </Col>
      ))}
      <Text size={11} color={C.faint}>
        {t.examplesNote}
      </Text>
    </Col>
  )
}
