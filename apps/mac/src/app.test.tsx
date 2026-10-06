import { DatabaseSync } from 'node:sqlite'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { createDictionary, type DictData } from '@kikitori/core/jmdict'
import { createAccentTable } from '@kikitori/core/pitch'
import { seedOnce } from '@kikitori/core/seed'
import { createStore } from '@kikitori/core/store'
import { testAnalyzer } from '@kikitori/core/test/analyzer'
import { sqliteDatabase, type SqlDriver } from '@kikitori/sqlite'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { fakeAudio } from './audio/audio'
import type { AppDeps } from './context'
import { keyEvents } from './keys'
import { memoryPrefs } from './platform/prefs'

const DICT: DictData = {
  version: 'test',
  dictDate: '2026-01-01',
  tags: { n: 'noun', adv: 'adverb' },
  entries: [[['毎朝'], ['まいあさ'], [[['n', 'adv'], ['every morning']]]]],
}

/** The whole app on an in-memory database with the real starter lessons, in a tall test window. */
async function open(transcripts: string[] = []) {
  const db = sqliteDatabase(new DatabaseSync(':memory:') as unknown as SqlDriver)
  const store = createStore(db)
  const prefs = memoryPrefs()
  await seedOnce(store, () => prefs)
  const deps: AppDeps = {
    db,
    store,
    analyzer: await testAnalyzer(),
    dictionary: async () => createDictionary(DICT),
    accents: async () => createAccentTable({ accents: { '毎朝|まいあさ': '0' } }),
    settings: { lang: 'en', furigana: true, translation: true, chunks: false, rate: 1 },
    keys: keyEvents(),
    audio: fakeAudio(transcripts),
    mediaPath: async () => null,
  }
  // The test window is capped at the screen's height, so clicks scroll their target into the
  // window first (getPaintedText does see the whole scrolled content).
  const { render, renderer } = createTestRoot({ width: 1000, height: 900 })
  render(<App deps={deps} />)
  const app = await connectTest(renderer)
  const painted = () => {
    renderer.flush()
    return renderer.getPaintedText()
  }
  /** Waits for the database queries behind the screen to land. */
  const shows = (text: string) => expect.poll(painted, { timeout: 5000 }).toContain(text)
  const hides = (text: string) => expect.poll(painted, { timeout: 5000 }).not.toContain(text)
  const lessonId = async (title: string) => (await db.lessons.all()).find((l) => l.title === title)!.id!
  /** Waits for an element to appear (after a click, a state change lands a frame later). */
  const appears = (testId: string) =>
    expect
      .poll(async () => {
        renderer.flush()
        return app.getByTestId(testId).count()
      }, { timeout: 5000 })
      .toBeGreaterThan(0)
  /** Clicks an element once it's there, first scrolling the page so it's inside the window. */
  const click = async (testId: string) => {
    await appears(testId)
    const target = app.getByTestId(testId)
    const box = await target.bounds()
    const { height } = renderer.getWindowSize()
    if (box.y + box.height > height) {
      // scrollIntoView doesn't move this test renderer's scroll areas; scrollTo does.
      const page = (await app.getByTestId('scroll').element()).id
      const [x, y] = renderer.getScrollOffset(page) ?? [0, 0]
      renderer.scrollTo(page, x, y - (box.y + box.height - height + 40))
      // A scroll applies on the next frame: let time pass and paint before clicking.
      renderer.flush()
      renderer.advanceTime(50)
      renderer.flush()
    }
    await target.click()
  }
  return { db, store, deps, app, painted, shows, hides, lessonId, click, appears }
}

describe.runIf(hasNativeTestRenderer)('macOS app', () => {
  it('opens on Today with every starter lesson due', async () => {
    const { painted, shows } = await open()
    await shows('私の朝')
    for (const title of ['私の朝', '週末のカフェ', '「間」の文化', '便利さの代償']) expect(painted()).toContain(title)
    expect(painted()).toContain('DUE NOW')
  })

  it('lists the library newest first', async () => {
    const { click, store, painted, shows } = await open()
    await store.createLesson({ title: '新しいレッスン', sentences: [{ start: null, end: null, text: '雨です。' }] }, Date.now() + 1000)
    await click('tab-library')
    await shows('新しいレッスン')
    const text = painted()
    expect(text.indexOf('新しいレッスン')).toBeLessThan(text.indexOf('私の朝'))
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
      const o = await open([...SENTENCES, SENTENCES.join('')])
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
      const o = await open(['私は毎朝6時に起きます'])
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
      const o = await open(['ぜんぜんちがう'])
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
      const o = await open([SENTENCES[2]])
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
