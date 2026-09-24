import { useSyncExternalStore } from 'react'

/**
 * The learner's Anthropic API key, kept apart from settings so it never
 * lands in an exported backup file.
 */
const KEY = 'kikitori.anthropicKey'
const listeners = new Set<() => void>()

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAiKey(value: string) {
  try {
    if (value) localStorage.setItem(KEY, value)
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: the key can't be kept */
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useAiKey = () => useSyncExternalStore(subscribe, read, () => '')
