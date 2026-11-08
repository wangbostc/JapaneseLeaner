import { afterEach, describe, expect, it } from 'vitest'
import type { Lesson } from '@kikitori/core/model'
import { prepareAll, prepareAllState, preparable, resetPrepareAll, stopPrepareAll } from './prepareAll'
import type { prepareMissing } from './neuralVoice'

const lesson = (id: number, texts: string[], mediaId?: number) =>
  ({ id, title: `L${id}`, sentences: texts.map((text) => ({ text, start: null, end: null })), mediaId, createdAt: id }) as unknown as Lesson

afterEach(() => resetPrepareAll())

describe('prepare all lessons', () => {
  it('covers lessons read aloud, not those with their own recording or no sentences', () => {
    expect(preparable([lesson(1, ['一。']), lesson(2, ['二。'], 7), lesson(3, [])]).map((l) => l.id)).toEqual([1])
  })

  it("sends every read-aloud lesson's sentences, shows progress, and ends done", async () => {
    const sent: string[][] = []
    const during: string[] = []
    const fake: typeof prepareMissing = async (texts, _voice, onProgress) => {
      sent.push(texts)
      onProgress({ done: 1, total: 2, failed: 0 })
      during.push(prepareAllState().kind)
      return { done: 2, total: 2, failed: 1 }
    }
    await prepareAll([lesson(1, ['一。', '二。']), lesson(2, ['三。'], 7)], 'voicevox:3', fake)
    expect(sent).toEqual([['一。', '二。']])
    expect(during).toEqual(['running'])
    expect(prepareAllState()).toEqual({ kind: 'done', voice: 'voicevox:3', lessons: 1, progress: { done: 2, total: 2, failed: 1 }, stopped: false })
  })

  it('runs once at a time', async () => {
    let calls = 0
    let release!: () => void
    const fake: typeof prepareMissing = async () => {
      calls++
      await new Promise<void>((r) => (release = r))
      return { done: 1, total: 1, failed: 0 }
    }
    const first = prepareAll([lesson(1, ['一。'])], 'voicevox:3', fake)
    await prepareAll([lesson(1, ['一。'])], 'voicevox:3', fake)
    release()
    await first
    expect(calls).toBe(1)
  })

  it('can be stopped, and says how far it got', async () => {
    const fake: typeof prepareMissing = async (_texts, _voice, onProgress, opts) => {
      onProgress({ done: 1, total: 3, failed: 0 })
      stopPrepareAll()
      opts!.signal!.throwIfAborted()
      return { done: 3, total: 3, failed: 0 }
    }
    await prepareAll([lesson(1, ['一。', '二。', '三。'])], 'voicevox:3', fake)
    expect(prepareAllState()).toMatchObject({ kind: 'done', stopped: true, progress: { done: 1, total: 3 } })
  })

  it('reports why it ended early', async () => {
    const fake: typeof prepareMissing = async () => {
      throw new Error('engineOff')
    }
    await prepareAll([lesson(1, ['一。'])], 'voicevox:3', fake)
    expect(prepareAllState()).toMatchObject({ kind: 'error', message: 'engineOff' })
  })
})
