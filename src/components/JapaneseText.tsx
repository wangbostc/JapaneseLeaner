import { Fragment, type ReactNode } from 'react'
import { phrases, senseGroups, textOf } from '../lib/chunking'
import { rubySegments } from '../lib/furigana'
import { contentLemmas } from '../lib/scoring'
import type { Analyzer, Token } from '../lib/tokenizer'

interface Props {
  text: string
  analyzer: Analyzer | null
  furigana: boolean
  onWord?: (token: Token) => void
  className?: string
  /** Show 文節 gaps and, in long sentences, 意群 separators. */
  chunked?: boolean
  /** When given, each sense unit gets a small play button (text-only lessons, read by TTS). */
  onPlayGroup?: (text: string) => void
  playLabel?: string
}

/** Japanese text with optional furigana; content words are tappable. */
export function JapaneseText({ text, analyzer, furigana, onWord, className, chunked, onPlayGroup, playLabel }: Props) {
  if (!analyzer) return <span className={className} lang="ja">{text}</span>
  const tokens = analyzer.tokenize(text)
  const renderToken = (t: Token, i: number) => {
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
  }

  if (!chunked) return <span className={className} lang="ja">{tokens.map(renderToken)}</span>

  const phraseRanges = phrases(tokens)
  const groups = senseGroups(tokens)
  const split = groups.length > 1
  return (
    <span className={`${className ?? ''} chunked`} lang="ja">
      {groups.map(([gs, ge]) => {
        const inGroup: ReactNode[] = phraseRanges
          .filter(([ps]) => ps >= gs && ps < ge)
          .map(([ps, pe]) => (
            <span key={ps} className="phrase">
              {tokens.slice(ps, pe).map((t, k) => renderToken(t, ps + k))}
            </span>
          ))
        return (
          <span key={gs} className={split ? 'sense-group' : undefined} data-testid={split ? 'sense-group' : undefined}>
            {inGroup}
            {split && onPlayGroup && (
              <button type="button" className="play-group" aria-label={playLabel} onClick={() => onPlayGroup(textOf(tokens, [gs, ge]))}>
                ▶
              </button>
            )}
          </span>
        )
      })}
    </span>
  )
}
