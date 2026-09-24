import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'

const clip = join(import.meta.dirname, 'fixtures', 'clip.wav')
const TRUTH = ['おはようございます。', '今日はいい天気ですね。', '一緒に散歩しましょう。']

async function openImportWithAudio(page: Page) {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
  await page.goto('./#/import')
  await page.getByRole('textbox', { name: /^Title/ }).fill('散歩')
  await page.getByLabel(/^Audio/).setInputFiles(clip)
  await expect(page.getByTestId('transcribe')).toBeVisible()
}

test('transcribing fills a timed transcript the learner can review', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __kikitoriFakeAsr: () => unknown }).__kikitoriFakeAsr = () => [
      { timestamp: [0.5, 2.1], text: 'おはようございます。' },
      { timestamp: [2.5, 7.1], text: '今日はいい天気ですね。一緒に散歩しましょう。' },
    ]
  })
  await openImportWithAudio(page)
  await page.getByRole('button', { name: 'Transcribe' }).click()
  await expect(page.getByText('Transcript ready below.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^Transcript/ })).toHaveValue(/00:00:00,500 --> 00:00:02,100\nおはようございます。/)
  await expect(page.getByTestId('import-preview')).toHaveText('3 sentences detected')
  await expect(page.getByTestId('transcribe')).toHaveCount(0) // timed now, so the offer goes away

  await page.getByRole('button', { name: 'Create lesson' }).click()
  await expect(page.locator('.transcript li')).toHaveText(TRUTH)
})

test.describe('without the service worker', () => {
  // Requests a service worker handles bypass page.route, so this test counts fetches without one.
  test.use({ serviceWorkers: 'block' })

test('a failed run can be retried with a fresh worker, and errors are shown, not hung', async ({ page }) => {
  let workerRequests = 0
  await page.route('**/assets/transcribe.worker-*.js', (route) => (++workerRequests === 1 ? route.fulfill({ status: 404 }) : route.continue()))
  // No model downloads in this test: the second run gets a worker, then fails to fetch the model.
  await page.route('https://huggingface.co/**', (route) => route.abort())
  await openImportWithAudio(page)

  await page.getByRole('button', { name: 'Transcribe' }).click()
  await expect(page.getByText('Transcription failed.')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Transcribe' }).click()
  await expect.poll(() => workerRequests).toBe(2)
  await expect(page.getByText('Transcription failed.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Transcribe' })).toBeEnabled()
})
})

// Downloads the real Whisper model (~80 MB) and runs it in the browser. Opt in: WHISPER_E2E=1.
test('real Whisper transcribes the fixture accurately', async ({ page }) => {
  test.skip(!process.env.WHISPER_E2E, 'set WHISPER_E2E=1 to download and run the real model')
  test.setTimeout(15 * 60_000)
  const assetHosts = new Set<string>()
  page.on('request', (r) => {
    if (/\.(wasm|mjs)(\?|$)/.test(r.url())) assetHosts.add(new URL(r.url()).host)
  })
  await openImportWithAudio(page)
  await page.getByRole('button', { name: 'Transcribe' }).click()
  await expect(page.getByText('Transcript ready below.')).toBeVisible({ timeout: 14 * 60_000 })
  // The ONNX runtime comes from our own origin, not a CDN.
  expect([...assetHosts]).toEqual([new URL(page.url()).host])
  const srt = await page.getByRole('textbox', { name: /^Transcript/ }).inputValue()
  const text = srt
    .split('\n')
    .filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->'))
    .join('')
  const norm = (s: string) => [...s.replace(/[。、！？\s]/g, '')]
  const [a, b] = [norm(TRUTH.join('')), norm(text)]
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  const cer = d[a.length][b.length] / a.length
  console.log(`[whisper-e2e] ${test.info().project.name} CER=${cer.toFixed(3)} text=${text}`)
  expect(cer).toBeLessThan(0.15)
  await expect(page.getByTestId('import-preview')).toContainText('sentences detected')
})
