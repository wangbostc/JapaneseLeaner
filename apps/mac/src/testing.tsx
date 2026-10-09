// Runs the whole app for tests: in-memory SQLite, real lessons, fake audio and file dialogs.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot } from '@gpuix/react/testing'
import { createDictionary, type DictData } from '@kikitori/core/jmdict'
import { createAccentTable } from '@kikitori/core/pitch'
import { seedOnce } from '@kikitori/core/seed'
import { createStore } from '@kikitori/core/store'
import { testAnalyzer } from '@kikitori/core/test/analyzer'
import { sqliteDatabase, type SqlDriver } from '@kikitori/sqlite'
import { expect } from 'vitest'
import { App } from './App'
import { fakeAudio } from './audio/audio'
import { fakeEngineFetch, type FakeEngines } from './audio/fakeEngines'
import { engineVoices } from './audio/voices'
import type { AppDeps } from './context'
import { keyEvents } from './keys'
import { nodeFiles } from './platform/files'
import { mediaCache } from './platform/media'
import { memoryPrefs } from './platform/prefs'
import type { MacSettings } from './settings'

export const DICT: DictData = {
  version: 'test',
  dictDate: '2026-01-01',
  tags: { n: 'noun', adv: 'adverb' },
  entries: [[['毎朝'], ['まいあさ'], [[['n', 'adv'], ['every morning']]]]],
}

/** The whole app on an in-memory database with the real starter lessons, in a test window. */
export interface OpenOptions {
  /** What each spoken attempt "hears", in order. */
  transcripts?: string[]
  /** What each file dialog "chooses", in order (null: cancelled). */
  picks?: (string[] | null)[]
  /** Core words a day (off unless a test is about them, so card counts stay put). */
  newWordsPerDay?: number
  /** The engines "running" on this Mac (none unless a test is about them). */
  engines?: FakeEngines
  /** Settings saved before the app starts, over the tests' defaults. */
  settings?: Partial<MacSettings>
}

export async function open({ transcripts = [], picks = [], newWordsPerDay = 0, engines = {}, settings = {} }: OpenOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kikitori-test-'))
  const db = sqliteDatabase(new DatabaseSync(':memory:') as unknown as SqlDriver)
  const store = createStore(db)
  const prefs = memoryPrefs()
  const audio = fakeAudio(transcripts)
  const media = mediaCache(db, join(dir, 'media'))
  const engine = fakeEngineFetch(engines)
  const voices = engineVoices(join(dir, 'voices'), { fetch: engine.fetch })
  await seedOnce(store, () => prefs)
  const deps: AppDeps = {
    db,
    store,
    analyzer: await testAnalyzer(),
    dictionary: async () => createDictionary(DICT),
    accents: async () => createAccentTable({ accents: { '毎朝|まいあさ': '0' } }),
    settings: { lang: 'en', furigana: true, translation: true, chunks: false, rate: 1, newWordsPerDay, ...settings },
    prefs,
    keys: keyEvents(),
    audio,
    voices,
    files: nodeFiles(async () => picks.shift() ?? null),
    mediaPath: media.path,
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
  return { db, store, deps, audio, engine, prefs, dir, app, painted, shows, hides, lessonId, click, appears }
}

export type Opened = Awaited<ReturnType<typeof open>>
