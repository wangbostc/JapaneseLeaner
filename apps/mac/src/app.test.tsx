import { hasNativeTestRenderer } from '@gpuix/react/testing'
import { describe, expect, it } from 'vitest'
import type { fakeAudio } from './audio/audio'
import { open } from './testing'
import { PAGE_PADDING, PAGE_WIDTH } from './ui/theme'

describe.runIf(hasNativeTestRenderer)('macOS app', () => {
  it('opens on Today with every starter lesson due', async () => {
    const { painted, shows } = await open()
    await shows('私の朝')
    for (const title of ['私の朝', '週末のカフェ', '「間」の文化', '便利さの代償']) expect(painted()).toContain(title)
    expect(painted()).toContain('DUE NOW')
  })

  it('centres the page in a window wider than its column, the word sheet lined up with it', async () => {
    const { app, appears, click, lessonId } = await open()
    await appears('due')
    // The test window is 1000 wide; the column 860, its content inset 28.
    const inset = (1000 - PAGE_WIDTH) / 2 + PAGE_PADDING
    expect((await app.getByTestId('due').bounds()).x).toBeCloseTo(inset, 0)
    await click('tab-library')
    await click(`lesson-${await lessonId('私の朝')}`)
    await click('word-0-2')
    expect((await app.getByTestId('word-sheet').bounds()).x).toBeCloseTo(inset, 0)
  })

  it('shelves the library by textbook in lesson order, a page at a time, and comes back to the same page', async () => {
    const { click, store, painted, shows, hides, appears, lessonId } = await open()
    const at = Date.now()
    const add = (title: string, level: string | undefined, k: number) => store.createLesson({ title, level, sentences: [{ start: null, end: null, text: '雨です。' }] }, at + k)
    // Added out of order: L2's reading first, then L10, L1, L2's dialogue, then filler chapters.
    await add('本 L2 読み物', 'テスト本 · L2 読み書き', 1)
    await add('本 L10 会話', 'テスト本 · L10', 2)
    await add('本 L1 会話', 'テスト本 · L1', 3)
    await add('本 L2 会話', 'テスト本 · L2', 4)
    for (let k = 0; k < 20; k++) await add(`本 L${30 + k} 会話`, `テスト本 · L${30 + k}`, 10 + k)
    await add('自分のレッスン', undefined, 50)
    await click('tab-library')
    await shows('本 L1 会話')
    const text = painted()
    const order = ['L1', '本 L1 会話', 'L2', '本 L2 会話', '本 L2 読み物', 'L10', '本 L10 会話'].map((s) => text.indexOf(s))
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true)
    expect(text).toContain('24 lessons')
    expect(['L1', 'L2', 'L10'].map((h) => text.filter((s) => s === h).length)).toEqual([1, 1, 1]) // one heading a chapter
    expect(text).not.toContain('本 L46 会話') // the 21st: on page 2
    expect(text).not.toContain('私の朝') // the starters have their own shelf
    await click('page-2')
    await shows('本 L46 会話')
    await hides('本 L1 会話')
    // A lesson and back: still page 2.
    await click(`lesson-${await lessonId('本 L46 会話')}`)
    await click('tab-library')
    await shows('本 L46 会話')
    await click('shelf-starters')
    await shows('私の朝')
    const starters = painted()
    expect(starters.indexOf('私の朝')).toBeLessThan(starters.indexOf('「間」の文化')) // N5 before N1
    await click('shelf-mine')
    await shows('自分のレッスン')
    await appears('library')
  })

  it('shows a lesson with furigana and translations', async () => {
    const { click, shows, painted, lessonId } = await open()
    await shows('私の朝')
    await click(`lesson-${await lessonId('私の朝')}`)
    await shows('I get up at six every morning.')
    expect(painted()).toEqual(expect.arrayContaining(['わたし', '私', 'まいあさ', '毎朝']))
  })

  it('looks up a tapped word, saves it as a card, and closes on Escape', async () => {
    const { click, db, deps, shows, hides, lessonId } = await open()
    await shows('私の朝')
    const id = await lessonId('私の朝')
    await click(`lesson-${id}`)
    await shows('毎朝')
    await click('word-0-2') // 私 は 毎朝
    await shows('1. every morning · noun, adverb')
    await shows('平板 flat [0]')
    await click('save-word')
    await shows('Saved')
    expect((await db.cards.all()).map((c) => [c.front, c.reading, c.lessonId, c.context])).toEqual([['毎朝', 'まいあさ', id, '私は毎朝六時に起きます。']])
    deps.keys.emit('escape')
    await hides('Saved')
  })

  it('deletes a lesson after a second tap, back to a library one shorter', async () => {
    const { click, db, shows, hides, lessonId } = await open()
    await shows('私の朝')
    await click(`lesson-${await lessonId('私の朝')}`)
    await shows('Delete lesson')
    await click('delete')
    await shows('Tap again to delete')
    expect(await db.lessons.count()).toBe(15)
    await click('delete')
    await hides('私の朝')
    expect(await db.lessons.count()).toBe(14)
    await shows('週末のカフェ') // the library
  })

  it('moves a finished lesson to Coming up without a reload', async () => {
    const { store, painted, shows, lessonId } = await open()
    await shows('私の朝')
    expect(painted()).not.toContain('COMING UP')
    await store.finishRound(await lessonId('私の朝'), 0)
    await shows('COMING UP')
    const text = painted()
    expect(text.indexOf('私の朝')).toBeGreaterThan(text.indexOf('COMING UP'))
  })

  describe('studying', () => {
    const SENTENCES = [
      '私は毎朝六時に起きます。',
      'まず、窓を開けて、コーヒーを飲みます。',
      '朝ごはんはパンと卵です。',
      '七時半に家を出て、駅まで歩きます。',
      '電車の中で、日本語のポッドキャストを聞きます。',
      '短い時間ですが、毎日続けています。',
    ]
    type Opened = Awaited<ReturnType<typeof open>>
    const startLesson = async ({ click, shows, lessonId }: Opened, title = '私の朝') => {
      await shows(title)
      await click(`lesson-${await lessonId(title)}`)
      await click('start')
    }
    /** One spoken attempt: record, wait for the mic, stop. */
    const speak = async ({ click, appears }: Opened) => {
      await click('record')
      await appears('stop')
      await click('stop')
      await appears('record')
    }

    it('runs a whole first round, then schedules the first review', { timeout: 60000 }, async () => {
      const o = await open({ transcripts: [...SENTENCES, SENTENCES.join('')] })
      const { click, shows, appears, db, deps, lessonId } = o
      await startLesson(o)
      await shows('Intensive listening')
      await shows('1 of 6')
      expect((deps.audio as ReturnType<typeof fakeAudio>).spoken[0]).toBe(SENTENCES[0]) // read aloud on arrival
      await click('reveal')
      await shows('わたし')
      for (let k = 1; k < 6; k++) {
        await click('next')
        await shows(`${k + 1} of 6`)
      }
      await click('next') // finish the step

      await shows('Shadowing')
      for (let k = 0; k < 6; k++) {
        await shows(`${k + 1} of 6`)
        await speak(o)
        await appears('shadow-result')
        await shows('100')
        await click('next')
      }

      await shows('Blind listening')
      await click('play-all')
      await appears('blind-rate')
      await click('blind-all')

      await shows('Retell')
      await speak(o)
      await appears('retell-result')
      await shows('100%')
      await click('next')

      await appears('round-done')
      const id = await lessonId('私の朝')
      const lesson = (await db.lessons.get(id))!
      expect(lesson.progress.roundsDone).toBe(1)
      expect(lesson.resume).toBeNull()
      expect(lesson.hard).toEqual([])
      expect((await db.logs.all()).map((l) => [l.step, l.mode])).toEqual([
        ['intensive', 'input'],
        ['shadowing', 'output'],
        ['blind', 'input'],
        ['retell', 'output'],
      ])
      expect(await db.words.count()).toBeGreaterThan(10) // the intensive step's words are "met"
      await click('back-to-today')
      await shows('COMING UP')
      await shows('Review 1/7 · due in 6 hours')
    })

    it('resumes at the sentence where the learner left', { timeout: 30000 }, async () => {
      const o = await open()
      const { click, shows } = o
      await startLesson(o)
      await shows('1 of 6')
      await click('next')
      await click('next')
      await shows('3 of 6')
      await click('leave')
      await shows('▶ Continue')
      await click('start')
      await shows('3 of 6')
    })

    it('scores 6時 heard for 六時 as a perfect attempt', { timeout: 30000 }, async () => {
      const o = await open({ transcripts: ['私は毎朝6時に起きます'] })
      const { click, shows, appears } = o
      await shows('私の朝')
      await click(`lesson-${await o.lessonId('私の朝')}`)
      await click('practice-shadowing')
      await shows('1 of 6')
      await speak(o)
      await appears('shadow-result')
      await shows('S')
      await shows('100')
    })

    it('free practice leaves the schedule alone, but a weak attempt still marks the sentence hard', { timeout: 30000 }, async () => {
      const o = await open({ transcripts: ['ぜんぜんちがう'] })
      const { click, shows, appears, db, lessonId } = o
      const id = await lessonId('私の朝')
      await shows('私の朝')
      await click(`lesson-${id}`)
      await click('practice-shadowing')
      await speak(o)
      await appears('shadow-result')
      await shows('C')
      await expect.poll(async () => (await db.lessons.get(id))!.hard).toEqual([0])
      const lesson = (await db.lessons.get(id))!
      expect(lesson.progress.roundsDone).toBe(0)
      expect(lesson.resume).toBeNull()
    })

    it('takes a sentence out of the hard set once the drill scores it 75 or more', { timeout: 30000 }, async () => {
      const o = await open({ transcripts: [SENTENCES[2]] })
      const { click, shows, appears, db, store, lessonId } = o
      const id = await lessonId('私の朝')
      await store.setHard(id, 2, true)
      await shows('私の朝')
      await click(`lesson-${id}`)
      await click('practice-hardSentences')
      await shows('1 of 1')
      await speak(o)
      await appears('shadow-result')
      await expect.poll(async () => (await db.lessons.get(id))!.hard).toEqual([])
    })
  })
})
