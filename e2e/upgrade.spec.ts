import { expect, test } from '@playwright/test'

// What the previous release left in the browser: Dexie schema version 1 is IndexedDB version 10.
test('upgrades an existing v1 database in place: data kept, sync ids assigned', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kikitori.settings', JSON.stringify({ lang: 'en' }))
    localStorage.setItem('kikitori.seeded', '1') // an existing user: no fresh samples
  })
  // A same-origin page that doesn't run the app, so nothing else holds the database open.
  await page.goto('./favicon.svg')
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('kikitori', 10)
      open.onupgradeneeded = () => {
        const db = open.result
        const lessons = db.createObjectStore('lessons', { keyPath: 'id', autoIncrement: true })
        lessons.createIndex('createdAt', 'createdAt')
        db.createObjectStore('media', { keyPath: 'id', autoIncrement: true })
        const cards = db.createObjectStore('cards', { keyPath: 'id', autoIncrement: true })
        cards.createIndex('lessonId', 'lessonId')
        cards.createIndex('card.due', 'card.due')
        cards.createIndex('[lessonId+front]', ['lessonId', 'front'])
        const logs = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true })
        logs.createIndex('lessonId', 'lessonId')
        logs.createIndex('at', 'at')
        db.createObjectStore('words', { keyPath: 'lemma' })
      }
      open.onsuccess = () => {
        const tx = open.result.transaction(['lessons', 'cards'], 'readwrite')
        tx.objectStore('lessons').add({
          title: '私の朝',
          builtIn: true,
          createdAt: 1_790_000_000_000,
          sentences: [{ start: null, end: null, text: '私は毎朝六時に起きます。' }],
          progress: { roundsDone: 3, lastCompletedAt: 1_790_000_000_000 },
          resume: null,
          hard: [0],
        })
        tx.objectStore('cards').add({ lessonId: 1, kind: 'word', front: '起きる', reading: 'おきる', context: '私は毎朝六時に起きます。', card: { due: new Date(0), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 }, createdAt: 1 })
        tx.oncomplete = () => (open.result.close(), resolve())
        tx.onerror = () => reject(tx.error)
      }
    })
  })

  // Reload: the app opens the database at v2 and upgrades it.
  await page.goto('./#/library')
  await expect(page.getByRole('link', { name: /私の朝/ })).toBeVisible()
  await expect(page.getByText('Review 3/7')).toBeVisible()

  const rows = await page.evaluate(
    () =>
      new Promise<{ version: number; lesson: Record<string, unknown>; card: Record<string, unknown> }>((resolve) => {
        const open = indexedDB.open('kikitori')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['lessons', 'cards'])
          const l = tx.objectStore('lessons').getAll()
          const c = tx.objectStore('cards').getAll()
          tx.oncomplete = () => {
            resolve({ version: db.version, lesson: l.result[0], card: c.result[0] })
            db.close()
          }
        }
      }),
  )
  expect(rows.version).toBe(20)
  expect(rows.lesson).toMatchObject({ uid: 'sample:私の朝', updatedAt: 1_790_000_000_000, hard: [0], progress: { roundsDone: 3 } })
  expect(rows.card.uid).toMatch(/^[0-9a-f-]{36}$/)
  // The flashcard still works after the upgrade.
  await page.goto('./#/cards')
  await expect(page.getByTestId('flashcard')).toContainText('起きる')
})
