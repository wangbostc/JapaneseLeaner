import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' }))
    const w = window as unknown as { __next: string; __kikitoriFake: { transcript: () => string } }
    w.__next = ''
    w.__kikitoriFake = { transcript: () => w.__next }
  })
})

/** The lesson row as stored, straight from IndexedDB. */
const readLesson = (page: Page, title: string) =>
  page.evaluate(
    (title) =>
      new Promise<{ progress: unknown; resume: unknown; hard: number[] }>((resolve) => {
        const open = indexedDB.open('kikitori')
        open.onsuccess = () => {
          const req = open.result.transaction('lessons').objectStore('lessons').getAll()
          req.onsuccess = () => {
            open.result.close()
            resolve(req.result.find((l: { title: string }) => l.title === title))
          }
        }
      }),
    title,
  )

test('free practice leaves the schedule and resume point alone, but still marks weak sentences hard', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.lesson-row')).toHaveCount(3)
  // A scheduled session in progress: first study, shadowing step, sentence 3.
  const scheduledResume = { round: 0, stepIndex: 1, sentenceIndex: 3 }
  await page.evaluate(
    (resume) =>
      new Promise<void>((done) => {
        const open = indexedDB.open('kikitori')
        open.onsuccess = () => {
          const tx = open.result.transaction('lessons', 'readwrite')
          const store = tx.objectStore('lessons')
          const all = store.getAll()
          all.onsuccess = () => {
            const l = all.result.find((x: { title: string }) => x.title === '私の朝')
            l.resume = resume
            store.put(l)
          }
          tx.oncomplete = () => (open.result.close(), done())
        }
      }),
    scheduledResume,
  )
  await page.getByRole('link', { name: /私の朝/ }).click()
  const before = await readLesson(page, '私の朝')
  expect(before.progress).toEqual({ roundsDone: 0, lastCompletedAt: null })
  expect(before.resume).toEqual(scheduledResume)

  await page.getByRole('link', { name: 'Shadowing' }).click()
  await expect(page.getByText('私の朝 · Free practice')).toBeVisible()
  // A weak attempt on sentence 1, then skip through the rest.
  await page.getByRole('button', { name: 'Speak' }).click()
  await page.evaluate(() => ((window as unknown as { __next: string }).__next = 'わたし'))
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('shadow-result').locator('.grade')).toHaveText('C')
  for (let i = 1; i < 6; i++) await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Practice done' })).toBeVisible()

  const after = await readLesson(page, '私の朝')
  expect(after.progress).toEqual({ roundsDone: 0, lastCompletedAt: null }) // no round completed
  expect(after.resume).toEqual(scheduledResume) // the scheduled session's place is untouched
  expect(after.hard).toEqual([0]) // the weak sentence is now hard

  // The lesson is still due as a first study, and the hard drill is now offered.
  await page.getByRole('link', { name: 'Back' }).click()
  await expect(page.getByRole('link', { name: 'Hard sentences' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue' })).toBeVisible() // still resumes where it was
})

test('mastered lessons can still be practised', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('.lesson-row')).toHaveCount(3)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('kikitori')
        open.onsuccess = () => {
          const tx = open.result.transaction('lessons', 'readwrite')
          const store = tx.objectStore('lessons')
          const all = store.getAll()
          all.onsuccess = () => {
            const l = all.result.find((x: { title: string }) => x.title === '週末のカフェ')
            l.progress = { roundsDone: 8, lastCompletedAt: Date.now() }
            store.put(l)
          }
          tx.oncomplete = () => (open.result.close(), resolve())
        }
      }),
  )
  await page.goto('./#/library')
  await page.getByRole('link', { name: /週末のカフェ/ }).click()
  await expect(page.getByText('Lesson mastered')).toBeVisible()
  await page.getByRole('link', { name: 'Blind listening' }).click()
  await expect(page.getByRole('heading', { name: 'Blind listening' })).toBeVisible()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.getByRole('button', { name: 'Almost all' }).click()
  await expect(page.getByRole('heading', { name: 'Practice done' })).toBeVisible()
  expect((await readLesson(page, '週末のカフェ')).progress).toMatchObject({ roundsDone: 8 })
})
