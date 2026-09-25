import type { Lesson } from '../lib/db'
import { buildIcs } from '../lib/ics'
import { db } from '../lib/db'
import { REMINDER_TAG, reminderNotification, summarizeDue } from '../lib/reminders'
import { dueAt, nextRound } from '../lib/schedule'

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
  if (permission === 'granted') await checkDueNow()
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
