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
async function open() {
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
    settings: { lang: 'en', furigana: true, translation: true, chunks: false },
    keys: keyEvents(),
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
  /** Clicks an element, first scrolling the page so it's inside the window. */
  const click = async (testId: string) => {
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
  return { db, store, deps, app, painted, shows, hides, lessonId, click }
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
})
