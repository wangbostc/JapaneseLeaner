import { Fragment, type ReactNode } from 'react'
import { phrases, senseGroups, textOf } from '@kikitori/core/chunking'
import { rubySegments } from '@kikitori/core/furigana'
import { tokensIn } from '@kikitori/core/examples'
import { contentLemmas } from '@kikitori/core/scoring'
import type { Analyzer, Token } from '@kikitori/core/tokenizer'

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
  /** Accessible label for a group's play button, given its 1-based number; in the UI language. */
  playLabel?: (n: number) => string
  uiLang?: string
  /** Characters [start, end) to highlight (an example's word), by the tokens that cover them. */
  mark?: [number, number] | null
}

/** Japanese text with optional furigana; content words are tappable. */
export function JapaneseText({ text, analyzer, furigana, onWord, className, chunked, onPlayGroup, playLabel, uiLang, mark }: Props) {
  if (!analyzer) {
    if (!mark) return <span className={className} lang="ja">{text}</span>
    return (
      <span className={className} lang="ja">
        {text.slice(0, mark[0])}
        <mark>{text.slice(mark[0], mark[1])}</mark>
        {text.slice(mark[1])}
      </span>
    )
  }
  const tokens = analyzer.tokenize(text)
  const marked = tokensIn(
    text,
    tokens.map((t) => t.surface),
    mark ?? null,
  )
  const renderToken = (t: Token, i: number) => {
    const inner = marked.has(i) ? <mark key={i}>{plain(t)}</mark> : plain(t)
    const tappable = onWord && contentLemmas([t]).size > 0
    return tappable ? (
      <button key={i} type="button" className="word" onClick={() => onWord(t)}>
        {inner}
      </button>
    ) : (
      <Fragment key={i}>{inner}</Fragment>
    )
  }
  function plain(t: Token) {
    return furigana
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
  }

  if (!chunked) return <span className={className} lang="ja">{tokens.map(renderToken)}</span>

  const phraseRanges = phrases(tokens)
  const groups = senseGroups(tokens)
  const split = groups.length > 1
  return (
    <span className={`${className ?? ''} chunked`} lang="ja">
      {groups.map(([gs, ge], g) => {
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
              <button type="button" className="play-group" lang={uiLang} aria-label={playLabel?.(g + 1)} onClick={() => onPlayGroup(textOf(tokens, [gs, ge]))}>
                ▶
              </button>
            )}
          </span>
        )
      })}
    </span>
  )
}
