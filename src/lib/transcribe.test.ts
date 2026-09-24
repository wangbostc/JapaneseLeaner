import { describe, expect, it } from 'vitest'
import { parseTranscript } from './subtitles'
import { chunksToCues, cuesToSrt } from './transcribe'

describe('chunksToCues', () => {
  it('keeps one cue per chunk when chunks are sentences', () => {
    expect(
      chunksToCues(
        [
          { timestamp: [0, 2], text: 'おはようございます。' },
          { timestamp: [2, 5], text: '今日は、いい天気ですね。' },
        ],
        6,
      ),
    ).toEqual([
      { start: 0, end: 2, text: 'おはようございます。' },
      { start: 2, end: 5, text: '今日は、いい天気ですね。' },
    ])
  })

  it('shares a multi-sentence chunk out by sentence length', () => {
    // 3 + 9 characters over 6 seconds: 1.5 s and 4.5 s.
    expect(chunksToCues([{ timestamp: [1, 7], text: 'はい。そうですね、はい。' }], 7)).toEqual([
      { start: 1, end: 2.5, text: 'はい。' },
      { start: 2.5, end: 7, text: 'そうですね、はい。' },
    ])
  })

  it('ends an open tail chunk at the next chunk or the end of the audio', () => {
    expect(chunksToCues([{ timestamp: [0, null], text: '終わり。' }], 3.5)).toEqual([{ start: 0, end: 3.5, text: '終わり。' }])
  })
})

describe('cuesToSrt', () => {
  it('round-trips through the SRT parser', () => {
    const cues = [
      { start: 0.6, end: 2.016, text: 'おはようございます。' },
      { start: 62.5, end: 3725.25, text: 'またね。' },
    ]
    const srt = cuesToSrt(cues)
    expect(srt).toContain('01:02:05,250')
    expect(parseTranscript('transcribed.srt', srt)).toEqual(cues)
  })
})
