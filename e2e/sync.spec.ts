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

test('the static build (no server) hides sync entirely', async ({ page }) => {
  await page.goto('http://localhost:' + (process.env.E2E_PORT ?? '4173') + '/#/settings')
  await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible()
  await expect(page.getByTestId('sync-section')).toHaveCount(0)
})
