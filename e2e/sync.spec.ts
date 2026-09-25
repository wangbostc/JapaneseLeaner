import { expect, test, type Browser, type Page } from '@playwright/test'

// Runs against the real Worker (wrangler dev, local D1): two browser contexts are two devices.
const SETUP = 'e2e-sync-setup-code'

async function newDevice(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
  await page.goto('./#/settings')
  const section = page.getByTestId('sync-section')
  await expect(section).toBeVisible()
  await section.getByLabel('Setup code').fill(SETUP)
  await section.getByLabel('This device’s name').fill(name)
  await section.getByRole('button', { name: 'Connect this device' }).click()
  await expect(section).toContainText(`Connected as “${name}”.`)
  await expect(page.getByTestId('sync-status')).toContainText('Last synced', { timeout: 20_000 })
  return page
}

async function syncNow(page: Page) {
  await page.goto('./#/settings')
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByTestId('sync-status')).toContainText('Last synced', { timeout: 20_000 })
}

test('a lesson made on one device shows up on the other, and deleting it there removes it here', async ({ browser }) => {
  const phone = await newDevice(browser, 'Phone')
  await phone.goto('./#/import')
  await phone.getByRole('textbox', { name: /^Title/ }).fill('同期テスト')
  await phone.getByRole('textbox', { name: /^Transcript/ }).fill('これは同期のテストです。')
  await phone.getByRole('button', { name: 'Create lesson' }).click()
  await expect(phone.getByRole('heading', { name: '同期テスト' })).toBeVisible()
  await syncNow(phone)

  const laptop = await newDevice(browser, 'Laptop') // connecting syncs straight away
  await laptop.goto('./#/library')
  await expect(laptop.getByRole('link', { name: /同期テスト/ })).toBeVisible()
  // The built-in samples didn't double up: three samples plus the imported lesson.
  await expect(laptop.locator('.lesson-row')).toHaveCount(4)

  await laptop.getByRole('link', { name: /同期テスト/ }).click()
  await laptop.getByRole('button', { name: 'Delete lesson' }).click()
  await laptop.getByRole('button', { name: 'Tap again to delete' }).click()
  await expect(laptop.getByRole('heading', { name: 'Library' })).toBeVisible() // the delete has finished
  await syncNow(laptop)

  await syncNow(phone)
  await phone.goto('./#/library')
  await expect(phone.getByRole('link', { name: /同期テスト/ })).toHaveCount(0)
  await expect(phone.locator('.lesson-row')).toHaveCount(3)
})

test('restoring an older backup on a connected device brings back what other devices made since', async ({ browser }) => {
  const phone = await newDevice(browser, 'Phone2')
  await phone.goto('./#/settings')
  const [download] = await Promise.all([phone.waitForEvent('download'), phone.getByRole('button', { name: 'Export backup' }).click()])
  const backupPath = test.info().outputPath('old-backup.json')
  await download.saveAs(backupPath)

  const laptop = await newDevice(browser, 'Laptop2')
  await laptop.goto('./#/import')
  await laptop.getByRole('textbox', { name: /^Title/ }).fill('あとから')
  await laptop.getByRole('textbox', { name: /^Transcript/ }).fill('あとで作りました。')
  await laptop.getByRole('button', { name: 'Create lesson' }).click()
  await expect(laptop.getByRole('heading', { name: 'あとから' })).toBeVisible()
  await syncNow(laptop)
  await syncNow(phone)

  // Restore the backup from before that lesson existed: the app resets its sync cursor.
  await phone.goto('./#/settings')
  await phone.getByTestId('restore-input').setInputFiles(backupPath)
  await phone.getByRole('alert').getByRole('button', { name: 'Restore backup' }).click()
  await expect(phone.getByText(/Restored \d+ lessons?\./)).toBeVisible()
  await expect(phone.getByTestId('sync-status')).toContainText('Last synced', { timeout: 20_000 })
  await phone.goto('./#/library')
  await expect(phone.getByRole('link', { name: /あとから/ })).toBeVisible({ timeout: 20_000 })
})

test('a connected device subscribes to server push reminders', async ({ browser }) => {
  // Headless Chromium can't grant the push permission (and has no push service), so only
  // pushManager.subscribe is faked; the key fetch, the POST to the Worker and the UI are real.
  const phone = await newDevice(browser, 'PushPhone')
  await phone.addInitScript(() => {
    let subscribed: unknown = null
    const w = window as unknown as { __appKey: number; __unsubscribed: number }
    w.__unsubscribed = 0
    PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
      const key = new Uint8Array(opts!.applicationServerKey as ArrayBuffer)
      w.__appKey = key.length
      subscribed = {
        endpoint: 'https://push.example/e2e-subscription',
        options: { applicationServerKey: key.buffer },
        toJSON: () => ({ endpoint: 'https://push.example/e2e-subscription', keys: { p256dh: 'x', auth: 'y' } }),
        unsubscribe: async () => ((subscribed = null), w.__unsubscribed++, true),
      }
      return subscribed as PushSubscription
    }
    PushManager.prototype.getSubscription = async () => subscribed as PushSubscription | null
  })
  const posted = phone.waitForResponse((r) => r.url().endsWith('/api/push/subscriptions') && r.request().method() === 'POST')
  await phone.goto('./#/settings')
  await phone.reload() // a new document, so the init script's fake is installed
  await expect(phone.getByTestId('enable-reminders')).toBeVisible() // permission still 'default'
  await phone.context().grantPermissions(['notifications']) // stands in for accepting the prompt
  await phone.getByTestId('enable-reminders').click()
  const res = await posted
  expect(res.status()).toBe(201)
  expect(res.request().postDataJSON()).toMatchObject({ endpoint: 'https://push.example/e2e-subscription' })
  expect(await phone.evaluate(() => (window as unknown as { __appKey: number }).__appKey)).toBe(65) // the server's P-256 public key
  await expect(phone.getByTestId('push-row').locator('.ok')).toHaveText('on')

  // Disconnecting tells the server and unsubscribes the browser, so this device stops getting pushes.
  const removed = phone.waitForResponse((r) => r.url().endsWith('/api/push/subscriptions') && r.request().method() === 'DELETE')
  await phone.getByRole('button', { name: 'Disconnect this device' }).click()
  expect((await removed).ok()).toBe(true)
  expect(await phone.evaluate(() => (window as unknown as { __unsubscribed: number }).__unsubscribed)).toBe(1)
  await expect(phone.getByTestId('push-row')).toContainText('Connect sync first.')
})

test('a connected device uses the server for AI, with no key in the browser', async ({ browser }) => {
  const phone = await newDevice(browser, 'AiPhone')
  await expect(phone.getByTestId('server-ai')).toBeVisible()
  await expect(phone.getByLabel('Anthropic API key')).toHaveCount(0)

  await phone.goto('./#/import')
  await phone.getByRole('textbox', { name: /^Title/ }).fill('AIテスト')
  await phone.getByRole('textbox', { name: /^Transcript/ }).fill('はじめまして。よろしく。')
  await phone.getByRole('button', { name: 'Create lesson' }).click()
  await phone.getByRole('button', { name: /Translate with AI/ }).click()
  await expect(phone.locator('.transcript .translation')).toHaveText(['server translation 1', 'server translation 2'])

  await phone.getByRole('link', { name: 'Start' }).click()
  await phone.getByRole('button', { name: 'Show text' }).first().click()
  await phone.getByRole('button', { name: /Explain/ }).click()
  await expect(phone.getByTestId('explanation')).toHaveText('（サーバー経由）explained by the server.')
  expect(await phone.evaluate(() => localStorage.getItem('kikitori.anthropicKey'))).toBeNull()
})

test('translates a long lesson through the server in batches', async ({ browser }) => {
  const phone = await newDevice(browser, 'LongPhone')
  await phone.goto('./#/import')
  await phone.getByRole('textbox', { name: /^Title/ }).fill('長いレッスン')
  await phone.getByRole('textbox', { name: /^Transcript/ }).fill(Array.from({ length: 320 }, (_, i) => `文${i}です。`).join('\n'))
  await phone.getByRole('button', { name: 'Create lesson' }).click()
  await phone.getByRole('button', { name: /Translate with AI/ }).click()
  // 320 sentences > the server's 300 per request: two batches, every sentence translated.
  await expect(phone.locator('.transcript .translation')).toHaveCount(320)
})

test('a connected device speaks with the server’s natural voices, keeping each sentence on the device', async ({ browser }) => {
  const page = await newDevice(browser, 'Voice')
  const requests: string[] = []
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/tts') && requests.push(JSON.parse(r.postData() ?? '{}').voice))
  const select = page.getByTestId('voice-select')
  // Natural voices are the default once the server has them.
  await expect(select).toHaveValue('neural:ja-JP-NanamiNeural')
  await expect(select.locator('optgroup[label="Natural voices (server)"] option')).toHaveCount(8)

  const tryIt = page.getByRole('button', { name: '▶ Try' })
  const spoken = page.waitForResponse((r) => r.url().endsWith('/api/tts') && r.status() === 200)
  await tryIt.click()
  expect((await spoken).headers()['content-type']).toBe('audio/wav')
  await expect.poll(() => requests).toEqual(['ja-JP-NanamiNeural'])

  // Again: played from the device's cache, no second request.
  await tryIt.click()
  await page.waitForTimeout(500)
  expect(requests).toEqual(['ja-JP-NanamiNeural'])

  await select.selectOption('neural:ja-JP-KeitaNeural')
  await tryIt.click()
  await expect.poll(() => requests).toEqual(['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural'])
  const cached = await page.evaluate(async () => (await (await caches.open('tts-v1')).keys()).length)
  expect(cached).toBe(2)

  // Lessons use it too: the first step reads the first sentence aloud in the chosen voice.
  const texts: string[] = []
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/tts') && texts.push(JSON.parse(r.postData() ?? '{}').text))
  await page.goto('./#/library')
  await page.getByRole('link', { name: /私の朝/ }).click()
  await page.getByRole('link', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Intensive listening' })).toBeVisible()
  await expect.poll(() => texts).toContain('私は毎朝六時に起きます。')
  expect(requests.at(-1)).toBe('ja-JP-KeitaNeural')
  const studyUrl = page.url()

  // Opened straight onto a lesson, never visiting Settings: the app shell turns natural voices on.
  await page.evaluate(() => localStorage.removeItem('kikitori.neuralVoices'))
  texts.length = 0
  await page.goto('about:blank')
  await page.goto(studyUrl)
  await expect(page.getByRole('heading', { name: 'Intensive listening' })).toBeVisible()
  await expect.poll(() => texts).toContain('私は毎朝六時に起きます。')
})

test('opened offline, a connected device still plays the natural-voice audio it has cached', async ({ browser }) => {
  const page = await newDevice(browser, 'Offline')
  // Record which voice speaks: a natural clip (an audio element) or the device's own voice.
  await page.addInitScript(() => {
    const w = window as unknown as { __clips: string[]; __said: string[] }
    w.__clips = []
    w.__said = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      w.__clips.push(this.src)
      return play.call(this)
    }
    const speak = speechSynthesis.speak.bind(speechSynthesis)
    speechSynthesis.speak = (u) => (w.__said.push(u.text), speak(u))
  })
  await page.goto('./#/library')
  await page.getByRole('link', { name: /私の朝/ }).click()
  await page.getByRole('link', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Intensive listening' })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('tts-v1')).keys()).length)).toBeGreaterThan(0)
  const studyUrl = page.url()

  await page.context().setOffline(true)
  await page.goto('about:blank')
  await page.goto(studyUrl)
  await expect(page.getByRole('heading', { name: 'Intensive listening' })).toBeVisible()
  const clips = () => page.evaluate(() => (window as unknown as { __clips: string[] }).__clips)
  await expect.poll(clips).toHaveLength(1)
  expect((await clips())[0]).toMatch(/^blob:/)
  expect(await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).toEqual([])
  await page.context().setOffline(false)
})

test('VOICEVOX on the computer prepares a lesson, and the phone plays it in that voice', async ({ browser }) => {
  const engine = `http://127.0.0.1:${process.env.E2E_VOICEVOX_PORT ?? 50121}`
  const mac = await newDevice(browser, 'Mac')
  // VOICEVOX turned on for this device, pointed at the e2e engine (the default is 127.0.0.1:50021).
  await mac.evaluate((url) => localStorage.setItem('kikitori.voicevox', url), engine)
  await mac.reload()
  await expect(mac.getByTestId('voicevox-toggle')).toBeChecked()
  await expect(mac.getByTestId('voicevox-status')).toContainText('VOICEVOX is running: 3 voices')
  const select = mac.getByTestId('voice-select')
  await expect(select.locator('optgroup[label="VOICEVOX (this computer)"] option')).toHaveCount(3)
  // This e2e server also has Azure, whose Nanami is the default; choose No.7 explicitly.
  await select.selectOption('voicevox:30')
  await expect(mac.getByTestId('voice-credit')).toHaveText('VOICEVOX:No.7')
  await mac.goto('./#/library')
  const uploads: string[] = []
  mac.on('request', (r) => r.method() === 'PUT' && r.url().includes('/api/tts/clip') && uploads.push(new URL(r.url()).searchParams.get('text')!))
  await mac.getByRole('link', { name: /私の朝/ }).click()
  const prepare = mac.getByTestId('prepare-voice')
  await prepare.getByRole('button', { name: 'Prepare VOICEVOX audio for your other devices' }).click()
  await expect(prepare).toContainText('Ready on your other devices.')
  expect(new Set(uploads).size).toBe(6)
  await expect(prepare.getByTestId('voice-credit')).toHaveText('VOICEVOX:No.7')

  // The phone has no engine: it lists the prepared voice and plays the lesson from the server.
  const phone = await newDevice(browser, 'Phone')
  // A device that didn't turn VOICEVOX on never contacts an engine (that could prompt for local-network access).
  const engineRequests: string[] = []
  phone.on('request', (r) => /:(50021|50121)\//.test(r.url()) && engineRequests.push(r.url()))
  await phone.reload() // start-up again, now watched
  const phoneSelect = phone.getByTestId('voice-select')
  await expect(phoneSelect.locator('optgroup[label="VOICEVOX (prepared on your computer)"] option')).toHaveText(['No.7（アナウンス）'])
  await phoneSelect.selectOption('voicevox:30')
  await expect(phone.getByTestId('voicevox-toggle')).not.toBeChecked()
  const played = phone.waitForResponse((r) => r.url().endsWith('/api/tts') && r.request().postDataJSON()?.text === '私は毎朝六時に起きます。')
  await phone.goto('./#/library')
  await phone.getByRole('link', { name: /私の朝/ }).click()
  await expect(phone.getByTestId('prepare-voice')).toHaveCount(0) // no engine here
  await phone.getByRole('link', { name: 'Start' }).click()
  const res = await played
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('audio/wav')
  await expect(phone.getByTestId('voice-credit')).toHaveText('VOICEVOX:No.7')
  expect(engineRequests).toEqual([])
})

test('the static build (no server) hides sync entirely', async ({ page }) => {
  await page.goto('http://localhost:' + (process.env.E2E_PORT ?? '4173') + '/#/settings')
  await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible()
  await expect(page.getByTestId('sync-section')).toHaveCount(0)
})
