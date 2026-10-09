import { useSyncExternalStore } from 'react'
import Dexie from 'dexie'
import { database } from '../lib/store'
import { initialSyncState, SyncError, syncOnce, type Api, type SyncState } from '@kikitori/core/sync'

/**
 * Sync with the Kikitori server (same origin, /api). Only offered where the server exists:
 * the static GitHub Pages build has no /api, so the whole feature stays hidden there.
 */

const DEVICE_KEY = 'kikitori.device'
const STATE_KEY = 'kikitori.syncState'

interface DeviceInfo {
  id: string
  name: string
  token: string
}

export type SyncStatus =
  | { kind: 'unavailable' }
  | { kind: 'disconnected' }
  | { kind: 'idle'; device: string; lastSyncedAt: number | null }
  | { kind: 'syncing'; device: string; lastSyncedAt: number | null }
  | { kind: 'error'; device: string; lastSyncedAt: number | null; message: string }

const read = <T>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage blocked: sync lasts for this session only */
  }
}

let status: SyncStatus = { kind: 'unavailable' }
let lastSyncedAt: number | null = read<number>('kikitori.lastSyncedAt')
const listeners = new Set<() => void>()
const setStatus = (s: SyncStatus) => {
  status = s
  listeners.forEach((l) => l())
}
const device = () => read<DeviceInfo>(DEVICE_KEY)

export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
    () => status,
  )

/** An authenticated API caller for this device, or null if it isn't connected. */
export function deviceApi(): Api | null {
  const d = device()
  return d && status.kind !== 'unavailable' ? authed(d.token) : null
}

/**
 * This device's API caller whenever it holds a token, even while the server can't be reached
 * (opened offline). For work that has a local fallback, such as cached natural-voice audio.
 */
export function storedDeviceApi(): Api | null {
  const d = device()
  return d ? authed(d.token) : null
}

const authed = (token: string): Api => (path, init = {}) =>
  fetch(path.replace(/^\//, ''), { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } })

/** Checks whether this origin has the API (the Worker build) and sets the starting status. */
export async function detectServer(): Promise<boolean> {
  const ok = await fetch('api/health')
    .then(async (r) => r.ok && (await r.json()).ok === true)
    .catch(() => false)
  const d = device()
  setStatus(!ok ? { kind: 'unavailable' } : d ? { kind: 'idle', device: d.name, lastSyncedAt } : { kind: 'disconnected' })
  return ok
}

export type ConnectResult = { ok: true } | { ok: false; message: string }

/** Exchanges the setup code for this device's token. */
export async function connect(setupCode: string, name: string): Promise<ConnectResult> {
  const res = await fetch('api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupCode, name }) })
  const body = (await res.json().catch(() => ({}))) as { token?: string; device?: { id: string; name: string }; error?: string }
  if (!res.ok || !body.token || !body.device) return { ok: false, message: body.error ?? `HTTP ${res.status}` }
  write(DEVICE_KEY, { id: body.device.id, name: body.device.name, token: body.token })
  write(STATE_KEY, initialSyncState())
  setStatus({ kind: 'idle', device: body.device.name, lastSyncedAt: null })
  void syncNow()
  return { ok: true }
}

/**
 * After a backup restore replaced the local data, pull everything again and push everything
 * restored: records pulled before the restore were wiped locally and wouldn't come back otherwise.
 */
export function resetSyncCursor() {
  const state = read<SyncState>(STATE_KEY)
  if (!state) return
  write(STATE_KEY, { ...initialSyncState(), uploaded: state.uploaded })
  void syncNow()
}

/** Forgets this device's token (and revokes it on the server if reachable). */
export async function disconnect() {
  const d = device()
  // Stop server reminders for this browser before the token goes away.
  const { disablePushReminders } = await import('./reminders')
  await disablePushReminders(d ? authed(d.token) : null)
  if (d) await authed(d.token)(`/api/devices/${d.id}`, { method: 'DELETE' }).catch(() => undefined)
  write(DEVICE_KEY, null)
  write(STATE_KEY, null)
  setStatus({ kind: 'disconnected' })
}

let running: Promise<void> | null = null
let again = false
/** True while sync is writing server changes locally, so those writes don't schedule another sync. */
let applying = false

export function syncNow(): Promise<void> {
  if (holds > 0) {
    waiting = true
    return Promise.resolve()
  }
  if (running) {
    again = true
    return running
  }
  const d = device()
  if (!d || status.kind === 'unavailable') return Promise.resolve()
  running = (async () => {
    // Another tab of the app is reviewing cards: wait (it syncs itself once it lets go).
    if (await heldElsewhere()) {
      waiting = true
      return
    }
    setStatus({ kind: 'syncing', device: d.name, lastSyncedAt })
    try {
      // Only the sync's own local writes are ignored; the user's edits meanwhile schedule another sync.
      const result = await syncOnce(database, authed(d.token), read<SyncState>(STATE_KEY) ?? initialSyncState(), undefined, { applying: (on) => (applying = on) })
      write(STATE_KEY, result.state)
      lastSyncedAt = Date.now()
      write('kikitori.lastSyncedAt', lastSyncedAt)
      setStatus({ kind: 'idle', device: d.name, lastSyncedAt })
    } catch (e) {
      if (e instanceof SyncError && e.status === 401) {
        // Revoked from another device: this one has to reconnect.
        write(DEVICE_KEY, null)
        setStatus({ kind: 'disconnected' })
      } else {
        setStatus({ kind: 'error', device: d.name, lastSyncedAt, message: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      running = null
    }
    if (again) {
      again = false
      await syncNow()
    }
  })()
  return running
}

/**
 * While held, syncing waits (and runs once the last hold is released). Reviewing cards holds it,
 * so the last grade stays undoable: a grade the server has can't be undone (merge.ts). Every tab
 * shares the database, so a hold also stops the app's other tabs syncing, through a shared Web
 * Lock (released with the tab, however it closes).
 */
const HOLD_LOCK = 'kikitori-sync-hold'
let holds = 0
let waiting = false
let unlock: (() => void) | null = null
/** Settles once this tab's lock is released (so a sync then doesn't see it as another tab's). */
let unlocked: Promise<unknown> = Promise.resolve()
export function holdSync(): () => void {
  if (holds++ === 0 && typeof navigator !== 'undefined' && navigator.locks) {
    unlocked = navigator.locks.request(HOLD_LOCK, { mode: 'shared' }, () => new Promise<void>((resolve) => (unlock = resolve))).catch(() => {})
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holds > 0) return
    unlock?.()
    unlock = null
    if (waiting) {
      waiting = false
      void unlocked.then(() => syncNow())
    }
  }
}

/** Whether another tab holds syncing (this tab's own holds are counted in `holds`). */
async function heldElsewhere(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.locks) return false
  const { held = [] } = await navigator.locks.query()
  return held.some((l) => l.name === HOLD_LOCK)
}

/** Resolves once no sync is running here (one that started before a hold carries on). */
export const syncIdle = (): Promise<void> => running ?? Promise.resolve()

const DEBOUNCE_MS = 4000
const INTERVAL_MS = 5 * 60_000

/** Starts automatic syncing: now, when the app comes back into view or online, shortly after local changes, and every few minutes. */
let started = false
export async function startAutoSync() {
  if (started) return
  started = true
  if (!(await detectServer())) {
    // Opened offline on a connected device: start once the network is back. (The static build
    // has no device, so it never retries.)
    if (device()) window.addEventListener('online', () => ((started = false), void startAutoSync()), { once: true })
    return
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const soon = () => {
    if (applying || !device()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void syncNow(), DEBOUNCE_MS)
  }
  // Fires after every committed write to any Dexie database in this page (and other tabs).
  Dexie.on('storagemutated', soon)
  // A moment later, so a screen that holds syncing (Cards) has taken its hold again first.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && setTimeout(() => void syncNow(), 0))
  window.addEventListener('online', () => void syncNow())
  setInterval(() => document.visibilityState === 'visible' && void syncNow(), INTERVAL_MS)
  void syncNow()
  // Keep an existing push subscription matched to the server's current key and record.
  if (device()) void import('./reminders').then((r) => r.refreshPushSubscription())
}
