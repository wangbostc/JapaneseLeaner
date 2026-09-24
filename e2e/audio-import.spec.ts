import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixtures = join(import.meta.dirname, 'fixtures')
const srt = readFileSync(join(fixtures, 'clip.srt'), 'utf8')
// Cue timings from clip.srt (built by scripts/make-audio-fixture.py).
const CUES = [...srt.matchAll(/(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/g)].map((m) => {
  const s = (h: string, mi: string, se: string, ms: string) => +h * 3600 + +mi * 60 + +se + +ms / 1000
  return { start: s(m[1], m[2], m[3], m[4]), end: s(m[5], m[6], m[7], m[8]) }
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' }))
    const w = window as unknown as { __media: { event: string; t: number }[] }
    w.__media = []
    const proto = HTMLMediaElement.prototype
    const play = proto.play
    const pause = proto.pause
    proto.play = function () {
      w.__media.push({ event: 'play', t: this.currentTime })
      return play.call(this)
    }
    proto.pause = function () {
      w.__media.push({ event: 'pause', t: this.currentTime })
      return pause.call(this)
    }
  })
})

const media = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __media: { event: string; t: number }[] }).__media)

test('imports audio with a timed transcript and plays each sentence as a segment', async ({ page }) => {
  expect(CUES).toHaveLength(3)
  await page.goto('./#/import')
  await page.getByRole('textbox', { name: /^Title/ }).fill('散歩')
  await page.getByLabel(/^Audio/).setInputFiles(join(fixtures, 'clip.wav'))

  // Audio with untimed text is refused.
  await page.getByRole('textbox', { name: /^Transcript/ }).fill('おはようございます。今日はいい天気ですね。')
  await expect(page.getByTestId('import-preview')).toContainText('needs a timed transcript')
  await expect(page.getByRole('button', { name: 'Create lesson' })).toBeDisabled()

  await page.getByLabel('Load file').setInputFiles(join(fixtures, 'clip.srt'))
  await expect(page.getByTestId('import-preview')).toHaveText('3 sentences detected')
  await page.getByRole('button', { name: 'Create lesson' }).click()
  await expect(page.locator('.transcript li')).toHaveCount(3)

  await page.getByRole('link', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Intensive listening' })).toBeVisible()

  // Sentence 1 auto-plays from its cue start and stops at its cue end.
  await expect.poll(async () => (await media(page)).filter((e) => e.event === 'pause').length, { timeout: 10_000 }).toBeGreaterThan(0)
  let log = await media(page)
  const firstPlay = log.find((e) => e.event === 'play')!
  const firstPause = log.find((e) => e.event === 'pause')!
  expect(firstPlay.t).toBeCloseTo(CUES[0].start, 1)
  expect(firstPause.t).toBeGreaterThanOrEqual(CUES[0].end)
  expect(firstPause.t).toBeLessThan(CUES[0].end + 0.5) // stopped at the cue, not the file end

  // Moving on plays sentence 2's segment.
  await page.evaluate(() => ((window as unknown as { __media: unknown[] }).__media.length = 0))
  await page.getByRole('button', { name: 'Next' }).click()
  const pausedInSentence2 = async () => (await media(page)).find((e) => e.event === 'pause' && e.t > CUES[1].start)
  await expect.poll(pausedInSentence2, { timeout: 10_000 }).toBeTruthy()
  log = await media(page)
  expect(log.find((e) => e.event === 'play' && e.t > 0.1)?.t).toBeCloseTo(CUES[1].start, 1)
  const pause2 = (await pausedInSentence2())!
  expect(pause2.t).toBeGreaterThanOrEqual(CUES[1].end)
  expect(pause2.t).toBeLessThan(CUES[1].end + 0.5)
})
