import { useSyncExternalStore } from 'react'
import Dexie from 'dexie'
import { db } from '../lib/db'
import { initialSyncState, SyncError, syncOnce, type Api, type SyncState } from '../lib/sync'

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

/** Forgets this device's token (and revokes it on the server if reachable). */
export async function disconnect() {
  const d = device()
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
  if (running) {
    again = true
    return running
  }
  const d = device()
  if (!d || status.kind === 'unavailable') return Promise.resolve()
  running = (async () => {
    setStatus({ kind: 'syncing', device: d.name, lastSyncedAt })
    try {
      applying = true
      const result = await syncOnce(db, authed(d.token), read<SyncState>(STATE_KEY) ?? initialSyncState())
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
      applying = false
      running = null
    }
    if (again) {
      again = false
      await syncNow()
    }
  })()
  return running
}

const DEBOUNCE_MS = 4000
const INTERVAL_MS = 5 * 60_000

/** Starts automatic syncing: now, when the app comes back into view or online, shortly after local changes, and every few minutes. */
let started = false
export async function startAutoSync() {
  if (started) return
  started = true
  if (!(await detectServer())) return
  let timer: ReturnType<typeof setTimeout> | null = null
  const soon = () => {
    if (applying || !device()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void syncNow(), DEBOUNCE_MS)
  }
  // Fires after every committed write to any Dexie database in this page (and other tabs).
  Dexie.on('storagemutated', soon)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncNow())
  window.addEventListener('online', () => void syncNow())
  setInterval(() => document.visibilityState === 'visible' && void syncNow(), INTERVAL_MS)
  void syncNow()
}
