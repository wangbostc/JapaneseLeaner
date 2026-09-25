/// <reference lib="webworker" />
// The service worker: offline caching (as before, now written out by hand) plus
// best-effort review reminders. Built by vite-plugin-pwa's injectManifest, which
// fills in self.__WB_MANIFEST with the precache list.
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import jmdictRelease from '../scripts/jmdict-release.json' with { type: 'json' }
import { KikitoriDB } from './lib/db'
import { summarizeDue } from './lib/reminders'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

const cacheFirst = (cacheName: string, maxEntries: number) =>
  new CacheFirst({ cacheName, plugins: [new ExpirationPlugin({ maxEntries })] })

// Transcription worker and ONNX runtime: opt-in, cached on first use.
registerRoute(({ url }) => /\/assets\/(transcribe\.worker-[^/]+\.js|[^/]+\.wasm)$/.test(url.pathname), cacheFirst('asr-runtime', 8))
// Versioned with kuromoji so a dictionary upgrade isn't masked by the old cache.
registerRoute(({ url }) => url.pathname.includes('/dict/'), cacheFirst('kuromoji-dict-0.1.2', 20))
// Word meanings; the cache is named after the pinned JMdict release.
registerRoute(({ url }) => url.pathname.endsWith('/jmdict/common.json'), cacheFirst(`jmdict-${jmdictRelease.version}`, 2))

// --- Reminders -----------------------------------------------------------

// Keep in sync with src/app/reminders.ts.
const REMINDER_TAG = 'kikitori-due-reviews'

/** Checks the schedule and, if reviews are due, shows one notification and sets the app badge. */
async function checkDue(): Promise<number> {
  const db = new KikitoriDB()
  try {
    const lessons = await db.lessons.toArray()
    const { due, reviewsDue } = summarizeDue(lessons, Date.now())
    const nav = self.navigator as WorkerNavigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (due) await nav.setAppBadge?.(due).catch(() => {})
    else await nav.clearAppBadge?.().catch(() => {})
    if (reviewsDue && Notification.permission === 'granted') {
      await self.registration.showNotification('Kikitori', {
        body: reviewsDue === 1 ? '1 review is due. 復習の時間です。' : `${reviewsDue} reviews are due. 復習の時間です。`,
        tag: REMINDER_TAG, // replaces the previous reminder instead of stacking
        icon: 'favicon.svg',
      })
    }
    return reviewsDue
  } finally {
    db.close()
  }
}

// Chromium, installed app only; the browser decides how often (often every 12 h or more).
self.addEventListener('periodicsync', (event) => {
  const e = event as ExtendableEvent & { tag: string }
  if (e.tag === REMINDER_TAG) e.waitUntil(checkDue())
})

// The app asks for a check when it opens and after settings change; tests use this too.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'check-due') event.waitUntil(checkDue().then((n) => event.ports[0]?.postMessage(n)))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows[0]
      if (open) return open.focus()
      return self.clients.openWindow(self.registration.scope)
    })(),
  )
})
