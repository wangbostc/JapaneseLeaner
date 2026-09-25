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
import { REMINDER_TAG, reminderNotification, summarizeDue } from './lib/reminders'

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


/** Checks the schedule and, if reviews are due, shows one notification and sets the app badge. */
async function checkDue(): Promise<number> {
  const db = new KikitoriDB()
  try {
    const lessons = await db.lessons.toArray()
    const { reviewsDue } = summarizeDue(lessons, Date.now())
    const nav = self.navigator as WorkerNavigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (reviewsDue) await nav.setAppBadge?.(reviewsDue).catch(() => {})
    else await nav.clearAppBadge?.().catch(() => {})
    // Just try: the worker's view of Notification.permission can lag a grant made after it
    // started, and showNotification fails harmlessly without permission.
    if (reviewsDue) {
      const { title, options } = reminderNotification(reviewsDue)
      await self.registration.showNotification(title, options).catch(() => {})
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

// On-demand check (the e2e tests use it; the page shows its own immediate reminder).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'check-due') event.waitUntil(checkDue().then((n) => event.ports[0]?.postMessage(n)))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const scope = self.registration.scope
      // Other apps can share this origin (github.io), so only reuse a window inside our scope,
      // and bring it to Today, where the due reviews are listed.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const ours = windows.find((c) => c.url.startsWith(scope))
      if (!ours) return self.clients.openWindow(scope)
      await ours.focus()
      return ours.navigate(scope).catch(() => ours)
    })(),
  )
})
