import { phrases } from '@kikitori/core/chunking'
import { rubySegments } from '@kikitori/core/furigana'
import { tokensIn } from '@kikitori/core/examples'
import { contentLemmas } from '@kikitori/core/scoring'
import type { Analyzer, Token } from '@kikitori/core/tokenizer'
import { Fragment, memo, useMemo } from 'react'
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
  /** Characters [start, end) to highlight (an example's word), by the tokens that cover them. */
  mark?: [number, number] | null
}

/**
 * Japanese text with furigana. gpuix has no ruby, so a word with a reading is a row of small
 * columns (reading over the text), and the words wrap as boxes in a row.
 *
 * A lesson draws hundreds of words, so each is kept to as few elements as it can be: a word with
 * no reading shown (kana, punctuation, or furigana off) is one text, set down by the reading's
 * height so it lines up with its neighbours. The analysis is done once per text, and the whole
 * is memoised: a change elsewhere in the app (the word sheet opening) doesn't redraw it.
 */
export const JapaneseText = memo(function JapaneseText({ text, analyzer, furigana, onWord, chunked, size = 22, testIdPrefix = 'word', mark }: Props) {
  const parsed = useMemo(() => {
    const tokens = analyzer.tokenize(text)
    return {
      tokens,
      segments: tokens.map((t) => rubySegments(t)),
      content: tokens.map((t) => contentLemmas([t]).size > 0),
      phraseEnds: new Set(phrases(tokens).map(([, end]) => end - 1)),
    }
  }, [analyzer, text])
  const { tokens, segments, content, phraseEnds } = parsed
  const marked = useMemo(
    () =>
      tokensIn(
        text,
        tokens.map((t) => t.surface),
        mark ?? null,
      ),
    [text, tokens, mark],
  )
  const rubySize = Math.round(size * 0.5)
  const main = { lineHeight: size + 8 }
  const word = (tok: Token, i: number) => {
    const space = chunked && phraseEnds.has(i) && i < tokens.length - 1 ? { marginRight: size * 0.4 } : {}
    // The gap goes outside the highlight, on whichever box is outermost.
    const gap = marked.has(i) ? {} : space
    const segs = segments[i]
    let body =
      furigana && segs.some((s) => s.ruby) ? (
        <Row style={{ alignItems: 'flex-end', ...gap }}>
          {segs.map((seg, k) =>
            seg.ruby ? (
              <Col key={k} style={{ alignItems: 'center' }}>
                <Text size={rubySize} color={C.ruby} ja style={{ lineHeight: rubySize + 3 }}>
                  {seg.ruby}
                </Text>
                <Text size={size} ja style={main}>
                  {seg.text}
                </Text>
              </Col>
            ) : (
              <Text key={k} size={size} ja style={main}>
                {seg.text}
              </Text>
            ),
          )}
        </Row>
      ) : (
        <Text size={size} ja style={{ ...main, ...(furigana ? { marginTop: rubySize + 3 } : {}), ...gap }}>
          {tok.surface}
        </Text>
      )
    if (marked.has(i)) body = <Row style={{ alignItems: 'flex-end', backgroundColor: C.mark, borderRadius: 3, ...space }}>{body}</Row>
    return onWord && content[i] ? (
      <Pressable key={i} testId={`${testIdPrefix}-${i}`} onPress={() => onWord(tok)} style={{ borderRadius: 4, alignItems: 'flex-end' }} hover={{ backgroundColor: C.raised }}>
        {body}
      </Pressable>
    ) : (
      <Fragment key={i}>{body}</Fragment>
    )
  }
  return <Row style={{ flexWrap: 'wrap', rowGap: 6, alignItems: 'flex-end' }}>{tokens.map(word)}</Row>
})
