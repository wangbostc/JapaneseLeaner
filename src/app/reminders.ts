import type { Lesson } from '../lib/db'
import { buildIcs } from '../lib/ics'
import { summarizeDue } from '../lib/reminders'
import { dueAt, nextRound } from '../lib/schedule'

export const REMINDER_TAG = 'kikitori-due-reviews'

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

/** Asks for notification permission and, where supported, background checks. Call from a button press. */
export async function enableReminders(): Promise<EnableResult> {
  const permission = 'Notification' in window ? await Notification.requestPermission() : 'denied'
  let background = false
  const reg = (await navigator.serviceWorker?.ready) as RegistrationWithSync | undefined
  if (permission === 'granted' && reg?.periodicSync) {
    try {
      // The browser treats this as a minimum and decides the real interval itself.
      await reg.periodicSync.register(REMINDER_TAG, { minInterval: 60 * 60 * 1000 })
      background = (await reg.periodicSync.getTags()).includes(REMINDER_TAG)
    } catch {
      background = false // not installed, or the browser declined
    }
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

/** Shows how many lessons are due on the installed app's icon. */
export function updateBadge(lessons: Pick<Lesson, 'progress'>[], now = Date.now()) {
  const nav = navigator as NavigatorWithBadge
  const { due } = summarizeDue(lessons, now)
  const op = due ? nav.setAppBadge?.(due) : nav.clearAppBadge?.()
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
