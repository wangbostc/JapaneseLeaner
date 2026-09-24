import { Fragment } from 'react'
import { rubySegments } from '../lib/furigana'
import { contentLemmas } from '../lib/scoring'
import type { Analyzer, Token } from '../lib/tokenizer'

interface Props {
  text: string
  analyzer: Analyzer | null
  furigana: boolean
  onWord?: (token: Token) => void
  className?: string
}

/** Japanese text with optional furigana; content words are tappable. */
export function JapaneseText({ text, analyzer, furigana, onWord, className }: Props) {
  if (!analyzer) return <span className={className} lang="ja">{text}</span>
  const tokens = analyzer.tokenize(text)
  return (
    <span className={className} lang="ja">
      {tokens.map((t, i) => {
        const inner = furigana
          ? rubySegments(t).map((seg, k) =>
              seg.ruby ? (
                <ruby key={k}>
                  {seg.text}
                  <rt>{seg.ruby}</rt>
                </ruby>
              ) : (
                <Fragment key={k}>{seg.text}</Fragment>
              ),
            )
          : t.surface
        const tappable = onWord && contentLemmas([t]).size > 0
        return tappable ? (
          <button key={i} type="button" className="word" onClick={() => onWord(t)}>
            {inner}
          </button>
        ) : (
          <Fragment key={i}>{inner}</Fragment>
        )
      })}
    </span>
  )
}
