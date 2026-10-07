import { phrases } from '@kikitori/core/chunking'
import { rubySegments } from '@kikitori/core/furigana'
import { contentLemmas } from '@kikitori/core/scoring'
import type { Analyzer, Token } from '@kikitori/core/tokenizer'
import { Col, Pressable, Row, Text } from './primitives'
import { C } from './theme'

interface Props {
  text: string
  analyzer: Analyzer
  furigana: boolean
  /** Content words become tappable. */
  onWord?: (token: Token) => void
  /** Gaps between 文節 phrases. */
  chunked?: boolean
  size?: number
  /** Prefix for each word's testId (`<prefix>-<token index>`), unique per page. */
  testIdPrefix?: string
}

/**
 * Japanese text with furigana. gpuix has no ruby, so each word is a small column (reading over
 * the text), and the words wrap as boxes in a row.
 */
export function JapaneseText({ text, analyzer, furigana, onWord, chunked, size = 22, testIdPrefix = 'word' }: Props) {
  const tokens = analyzer.tokenize(text)
  const rubySize = Math.round(size * 0.5)
  const word = (tok: Token, i: number, gapAfter: boolean) => {
    const body = (
      <Row style={{ alignItems: 'flex-end', ...(gapAfter ? { marginRight: size * 0.4 } : {}) }}>
        {(furigana ? rubySegments(tok) : [{ text: tok.surface }]).map((seg, k) => (
          <Col key={k} style={{ alignItems: 'center' }}>
            {furigana && (
              <Text size={rubySize} color={C.ruby} ja style={{ lineHeight: rubySize + 3 }}>
                {'ruby' in seg && seg.ruby ? seg.ruby : ' '}
              </Text>
            )}
            <Text size={size} ja style={{ lineHeight: size + 8 }}>
              {seg.text}
            </Text>
          </Col>
        ))}
      </Row>
    )
    return onWord && contentLemmas([tok]).size > 0 ? (
      <Pressable key={i} testId={`${testIdPrefix}-${i}`} onPress={() => onWord(tok)} style={{ borderRadius: 4 }} hover={{ backgroundColor: C.raised }}>
        {body}
      </Pressable>
    ) : (
      <Row key={i}>{body}</Row>
    )
  }
  const phraseEnds = new Set(chunked ? phrases(tokens).map(([, end]) => end - 1) : [])
  return <Row style={{ flexWrap: 'wrap', rowGap: 6 }}>{tokens.map((tok, i) => word(tok, i, phraseEnds.has(i) && i < tokens.length - 1))}</Row>
}
