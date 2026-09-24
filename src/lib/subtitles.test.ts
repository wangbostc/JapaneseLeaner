import { describe, expect, it } from 'vitest'
import { parseTranscript, splitSentences } from './subtitles'

describe('parseTranscript', () => {
  it('parses SRT', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nおはよう。\r\n\r\n2\r\n00:00:03,000 --> 00:01:04,250\r\n元気？\r\n'
    expect(parseTranscript('a.srt', srt)).toEqual([
      { start: 1, end: 2.5, text: 'おはよう。' },
      { start: 3, end: 64.25, text: '元気？' },
    ])
  })

  it('parses WebVTT without hours and strips tags', () => {
    const vtt = 'WEBVTT\n\n00:01.500 --> 00:03.000\n<v 先生>こんにちは\n'
    expect(parseTranscript('a.vtt', vtt)).toEqual([{ start: 1.5, end: 3, text: 'こんにちは' }])
  })

  it('parses LRC, ending each line at the next', () => {
    const lrc = '[ti:test]\n[00:01.20]一行目\n[00:04.5]二行目\n'
    expect(parseTranscript('a.lrc', lrc)).toEqual([
      { start: 1.2, end: 4.5, text: '一行目' },
      { start: 4.5, end: null, text: '二行目' },
    ])
  })
})

describe('robustness', () => {
  it('accepts SRT timestamps without milliseconds', () => {
    expect(parseTranscript('a.srt', '1\n00:00:01 --> 00:00:03\nはい\n')).toEqual([{ start: 1, end: 3, text: 'はい' }])
  })

  it('never throws on a stray arrow in plain text', () => {
    expect(parseTranscript('pasted.txt', '矢印は-->です。次の文。').map((c) => c.text)).toEqual(['矢印は-->です。', '次の文。'])
  })

  it('skips malformed cue blocks', () => {
    const srt = '1\nnonsense --> 00:00:02,000\nだめ\n\n2\n00:00:03,000 --> 00:00:04,000\nいい\n'
    expect(parseTranscript('a.srt', srt)).toEqual([{ start: 3, end: 4, text: 'いい' }])
  })

  it('recognises pasted LRC by content, keeping its timings', () => {
    expect(parseTranscript('pasted.txt', '[00:01.00]一\n[00:02.50]二')).toEqual([
      { start: 1, end: 2.5, text: '一' },
      { start: 2.5, end: null, text: '二' },
    ])
  })
})

describe('splitSentences', () => {
  it('splits after sentence enders and at line breaks', () => {
    expect(splitSentences('今日は雨です。傘を持っていますか？\nはい！').map((c) => c.text)).toEqual([
      '今日は雨です。',
      '傘を持っていますか？',
      'はい！',
    ])
  })
})
