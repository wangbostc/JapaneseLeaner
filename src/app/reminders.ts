import type { Lesson } from '../lib/db'
import { buildIcs } from '../lib/ics'
import { db } from '../lib/db'
import { REMINDER_TAG, reminderNotification, summarizeDue } from '../lib/reminders'
import { dueAt, nextRound } from '../lib/schedule'
import type { Api } from '../lib/sync'
import { deviceApi } from './sync'

type PeriodicSyncManager = { register(tag: string, opts: { minInterval: number }): Promise<void>; getTags(): Promise<string[]> }
type RegistrationWithSync = ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }
type NavigatorWithBadge = Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

export interface ReminderSupport {
  notifications: boolean
  /** Background checks while the app is closed: Chromium, installed app only. */
  periodicSync: boolean
  badge: boolean
  installed: boolean
}

export async function reminderSupport(): Promise<ReminderSupport> {
  const reg = (await navigator.serviceWorker?.getRegistration()) as RegistrationWithSync | undefined
  return {
    notifications: 'Notification' in window,
    periodicSync: Boolean(reg?.periodicSync),
    badge: 'setAppBadge' in navigator,
    installed: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
  }
}

export type EnableResult = { permission: NotificationPermission; background: boolean }

/**
 * Registers the background check if the browser allows it (Chromium, installed app,
 * notifications granted). Needs no user gesture, so it's also retried on each launch:
 * that covers installing the app after granting permission.
 */
export async function registerBackgroundCheck(): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  const reg = (await navigator.serviceWorker?.ready) as RegistrationWithSync | undefined
  if (!reg?.periodicSync) return false
  try {
    // The browser treats this as a minimum and decides the real interval itself.
    await reg.periodicSync.register(REMINDER_TAG, { minInterval: 60 * 60 * 1000 })
    return (await reg.periodicSync.getTags()).includes(REMINDER_TAG)
  } catch {
    return false // not installed, or the browser declined
  }
}

/**
 * Shows a reminder right away if reviews are already due. Runs on the page, not in the
 * service worker: right after the permission prompt, the worker may not see the grant yet.
 */
export async function checkDueNow(): Promise<void> {
  const reg = await navigator.serviceWorker?.ready
  if (!reg) return
  const { reviewsDue } = summarizeDue(await db.lessons.toArray(), Date.now())
  if (!reviewsDue) return
  const { title, options } = reminderNotification(reviewsDue)
  await reg.showNotification(title, options).catch((e) => console.warn('[kikitori] reminder', e))
}

/** Asks for notification permission, then sets up the background check. Call from a button press. */
export async function enableReminders(): Promise<EnableResult> {
  const permission = 'Notification' in window ? await Notification.requestPermission() : 'denied'
  const background = permission === 'granted' ? await registerBackgroundCheck() : false
  if (permission === 'granted') {
    await checkDueNow()
    // With sync connected, also take reminders from the server (works with the app closed, incl. iPhone).
    await enablePushReminders().catch(() => false)
  }
  return { permission, background }
}

export async function backgroundRemindersOn(): Promise<boolean> {
  const reg = (await navigator.serviceWorker?.getRegistration()) as RegistrationWithSync | undefined
  try {
    return Boolean(reg?.periodicSync && (await reg.periodicSync.getTags()).includes(REMINDER_TAG))
  } catch {
    return false
  }
}

/** Shows how many reviews are due on the installed app's icon (new lessons don't count, as in notifications). */
export function updateBadge(lessons: Pick<Lesson, 'progress'>[], now = Date.now()) {
  const nav = navigator as NavigatorWithBadge
  const { reviewsDue } = summarizeDue(lessons, now)
  const op = reviewsDue ? nav.setAppBadge?.(reviewsDue) : nav.clearAppBadge?.()
  op?.catch(() => {})
}

/** A calendar event for the lesson's next review, or null if nothing is scheduled. */
export function nextReviewEvent(lesson: Lesson & { id: number }, labels: { title: (round: number, lessonTitle: string) => string; body: string }) {
  const round = nextRound(lesson.progress)
  const at = dueAt(lesson.progress)
  if (!round || !at || round.index === 0) return null
  const url = `${location.origin}${location.pathname}#/lesson/${lesson.id}`
  return buildIcs({
    uid: `lesson-${lesson.id}-round-${round.index}@kikitori`,
    start: new Date(at),
    durationMinutes: 15,
    title: labels.title(round.index, lesson.title),
    description: `${labels.body}\n${url}`,
    url,
  })
}

/** Hands the .ics to the share sheet where supported (iOS), else downloads it. */
export async function saveIcs(ics: string, fileName: string) {
  const file = new File([ics], fileName, { type: 'text/calendar' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

export const pushSupported = () => 'PushManager' in window && 'serviceWorker' in navigator

/** The endpoint the server confirmed it stored; "on" means the browser's subscription is that one. */
const REGISTERED_KEY = 'kikitori.pushEndpoint'
const registered = () => {
  try {
    return localStorage.getItem(REGISTERED_KEY)
  } catch {
    return null
  }
}
const setRegistered = (endpoint: string | null) => {
  try {
    if (endpoint) localStorage.setItem(REGISTERED_KEY, endpoint)
    else localStorage.removeItem(REGISTERED_KEY)
  } catch {
    /* storage blocked */
  }
}

/** True if this browser's subscription is the one the server has (server reminders on). */
export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  return Boolean(sub && sub.endpoint === registered())
}

export type PushResult = { ok: true } | { ok: false; reason: 'unsupported' | 'permission' | 'disconnected' | 'notConfigured' | 'failed' }

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i])

/**
 * Subscribes this browser to the server's review reminders (Web Push). Needs notification
 * permission and a device connected for sync; on iPhone, only an app added to the home screen
 * (iOS 16.4+) can receive them. A subscription made with an older server key is replaced.
 */
export async function enablePushReminders(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  if (Notification.permission !== 'granted') return { ok: false, reason: 'permission' }
  const api = deviceApi()
  if (!api) return { ok: false, reason: 'disconnected' }
  const keyRes = await api('/api/push/key')
  if (keyRes.status === 503) return { ok: false, reason: 'notConfigured' }
  if (!keyRes.ok) return { ok: false, reason: 'failed' }
  const key = fromB64url(((await keyRes.json()) as { key: string }).key)
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    // The server's VAPID key changed: pushes to the old subscription would be rejected (403).
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const res = await api('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
  if (!res.ok) return { ok: false, reason: 'failed' }
  setRegistered(sub.endpoint)
  return { ok: true }
}

/** On launch: if this browser has push on, make sure it still matches the server's key and record. */
export async function refreshPushSubscription() {
  if (registered() && pushSupported() && Notification.permission === 'granted') await enablePushReminders().catch(() => undefined)
}

/** Turns server reminders off for this browser (used when disconnecting). */
export async function disablePushReminders(api: Api | null) {
  const sub = pushSupported() ? await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() : null
  if (sub) {
    if (api) await api('/api/push/subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined)
    await sub.unsubscribe().catch(() => false)
  }
  setRegistered(null)
}
