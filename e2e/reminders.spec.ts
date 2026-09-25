import { expect, test, type Page } from '@playwright/test'

// The minimal headless shell always reports notifications as denied; full Chromium supports them.
test.use({ channel: 'chromium' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' })))
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
  const lastDone = Date.UTC(2026, 8, 25, 0, 0)
  await setProgress(page, '私の朝', 1, lastDone)
  await page.goto('./#/library')
  await page.getByRole('link', { name: /私の朝/ }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('add-to-calendar').click()])
  const ics = Buffer.concat(await (await download.createReadStream()).toArray()).toString()
  expect(download.suggestedFilename()).toMatch(/^kikitori-review-\d+\.ics$/)
  expect(ics).toContain('\r\nDTSTART:20260925T060000Z\r\n') // review 1: 6 hours after completion
  expect(ics).toContain('SUMMARY:Kikitori review 1/7: 私の朝')
  expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY')
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
