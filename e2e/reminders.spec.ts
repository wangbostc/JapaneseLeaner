import { expect, test, type Page } from '@playwright/test'

// The minimal headless shell always reports notifications as denied; full Chromium supports them.
// Chromium otherwise hands notifications to the OS (macOS Notification Center), which parallel
// test browsers share: same-tag notifications from different instances then replace each other.
// Keep them inside each browser instead.
test.use({
  channel: 'chromium',
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=NativeNotifications,SystemNotifications'],
  },
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
})

// Notifications share a tag across tests in the same browser; close them so tests stay independent.
test.afterEach(async ({ page }) => {
  await page
    .evaluate(async () => {
      const reg = await navigator.serviceWorker?.getRegistration()
      for (const n of (await reg?.getNotifications()) ?? []) n.close()
    })
    .catch(() => {})
})

/** Rewrites the first sample lesson's progress straight in IndexedDB. */
async function setProgress(page: Page, title: string, roundsDone: number, lastCompletedAt: number) {
  await page.evaluate(
    ([title, roundsDone, lastCompletedAt]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('kikitori')
        open.onsuccess = () => {
          const tx = open.result.transaction('lessons', 'readwrite')
          const store = tx.objectStore('lessons')
          const all = store.getAll()
          all.onsuccess = () => {
            const lesson = all.result.find((l: { title: string }) => l.title === title)
            lesson.progress = { roundsDone, lastCompletedAt }
            store.put(lesson)
          }
          tx.oncomplete = () => (open.result.close(), resolve())
          tx.onerror = () => reject(tx.error)
        }
      }),
    [title, roundsDone, lastCompletedAt] as const,
  )
}

test('the next review can be saved as a calendar event with an alarm', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.lesson-row')).toHaveCount(3)
  // Relative to now: the button only shows while the review is still ahead.
  const lastDone = Math.floor(Date.now() / 60_000) * 60_000 - 3_600_000
  const dtstart = new Date(lastDone + 6 * 3_600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  await setProgress(page, '私の朝', 1, lastDone)
  await page.goto('./#/library')
  await page.getByRole('link', { name: /私の朝/ }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('add-to-calendar').click()])
  const ics = Buffer.concat(await (await download.createReadStream()).toArray()).toString()
  expect(download.suggestedFilename()).toMatch(/^kikitori-review-\d+\.ics$/)
  expect(ics).toContain(`\r\nDTSTART:${dtstart}\r\n`) // review 1: 6 hours after completion
  expect(ics).toContain('SUMMARY:Kikitori review 1/7: 私の朝')
  expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY')
})




test('Today moves a review to "Due now" when it comes due, without a reload', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.lesson-row')).toHaveCount(3)
  // Review 1 comes due 3 seconds from now.
  await setProgress(page, '私の朝', 1, Date.now() - 6 * 3_600_000 + 3000)
  await page.goto('./#/library')
  await page.goto('./')
  const dueSection = page.locator('h2:has-text("Due now") + .list')
  await expect(dueSection.getByRole('link', { name: /私の朝/ })).toHaveCount(0)
  await expect(dueSection.getByRole('link', { name: /私の朝/ })).toHaveCount(1, { timeout: 10_000 })
})

// Notifications behave the same under mobile emulation, so these run on the desktop project only.
test.describe('notifications', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'notification tests run on the desktop project')
    // A rejected showNotification is logged, not thrown; make it fail the test instead of looking like "no notification".
    page.on('console', (m) => {
      if (m.text().includes('[kikitori] reminder')) throw new Error(m.text())
    })
  })

  test('the service worker notifies about due reviews', async ({ page, context }) => {
    await context.grantPermissions(['notifications'])
    await page.goto('./')
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20_000 })
    await expect(page.locator('.lesson-row')).toHaveCount(3)

    // Nothing is a due review yet (only new lessons): no notification.
    const check = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const channel = new MessageChannel()
            channel.port1.onmessage = (e) => resolve(e.data)
            navigator.serviceWorker.controller!.postMessage({ type: 'check-due' }, [channel.port2])
          }),
      )
    expect(await check()).toBe(0)
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).getNotifications().then((n) => n.length))).toBe(0)

    await setProgress(page, '私の朝', 1, Date.now() - 7 * 3_600_000) // review 1 due an hour ago
    expect(await check()).toBe(1)
    const notes = await page.evaluate(async () =>
      (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag })),
    )
    expect(notes).toEqual([{ title: 'Kikitori', body: '1 review is due. 復習の時間です。', tag: 'kikitori-due-reviews' }])
  })

  test('Settings turns reminders on and shows what this browser supports', async ({ page, context }) => {
    await context.grantPermissions(['notifications'])
    await page.goto('./#/settings')
    await expect(page.getByTestId('reminder-support')).toContainText('Calendar events')
    // Permission was pre-granted, so the page already reports reminders on.
    await expect(page.getByText('Reminders are on.')).toBeVisible()
  })

  test('turning reminders on checks right away and notifies if a review is already due', async ({ page, context }) => {
    await page.goto('./')
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20_000 })
    await expect(page.locator('.lesson-row')).toHaveCount(3)
    await setProgress(page, '私の朝', 1, Date.now() - 7 * 3_600_000)
    await page.goto('./#/settings')
    await expect(page.getByTestId('enable-reminders')).toBeVisible() // permission is still 'default'
    await context.grantPermissions(['notifications']) // stands in for the user accepting the prompt
    await page.getByTestId('enable-reminders').click()
    await expect(page.getByText('Reminders are on.')).toBeVisible()
    await expect
      .poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length))
      .toBe(1)
  })

  test('a push from the server always shows a reminder, even before this device has synced the lesson', async ({ page, context }) => {
    await context.grantPermissions(['notifications'])
    await page.goto('./')
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20_000 })
    const [sw] = context.serviceWorkers()
    // No local review is due, but the server pushed: browsers require a visible notification.
    await sw.evaluate(() => (self as unknown as ServiceWorkerGlobalScope).dispatchEvent(new PushEvent('push')))
    await expect
      .poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.body)))
      .toEqual(['Time for a Japanese review. 復習の時間です。']) // no count this device can't back up
  })
})
