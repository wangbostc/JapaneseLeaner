import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Strings } from '@kikitori/core/i18n'
import type { AccentTable } from '@kikitori/core/pitch'
import type { Examples } from '@kikitori/core/examples'
import type { Dictionary } from '@kikitori/core/jmdict'
import type { Store } from '@kikitori/core/store'
import type { Analyzer, Token } from '@kikitori/core/tokenizer'
import type { Lesson } from '@kikitori/core/model'
import type { Step } from '@kikitori/core/schedule'
import type { WatchedDatabase } from '@kikitori/sqlite'
import type { Audio } from './audio/audio'
import type { EngineVoices } from './audio/voices'
import type { KeyValueStore } from '@kikitori/core/seed'
import type { KeyEvents } from './keys'
import type { Files } from './platform/files'
import type { MacSettings } from './settings'

/** Everything the app needs from the machine, handed in by main.tsx (or a test). */
export interface AppDeps {
  db: WatchedDatabase
  store: Store
  analyzer: Analyzer
  /** JMdict and the pitch-accent table, loaded on first use; null when unavailable. */
  dictionary: () => Promise<Dictionary | null>
  /** Example sentences for the dictionary's entries, loaded on first use; null when unavailable. */
  examples: () => Promise<Examples | null>
  accents: () => Promise<AccentTable | null>
  /** Settings at start; they change through `updateSettings`, saved in `prefs`. */
  settings: MacSettings
  prefs: KeyValueStore
  keys: KeyEvents
  /** Sound in and out; the app speaks through it in the chosen engine voice, if any. */
  audio: Audio
  /** AivisSpeech and VOICEVOX on this Mac. */
  voices: EngineVoices
  files: Files
  /** A file holding the lesson's audio (for the helper to play); null for lessons read aloud. */
  mediaPath: (lesson: Lesson) => Promise<string | null>
}

export type Route =
  | { name: 'today' }
  | { name: 'library' }
  | { name: 'import' }
  | { name: 'cards' }
  /** Every card, to search, suspend, edit or delete. */
  | { name: 'cardList' }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'lesson'; id: number }
  /** A round of study, or with `free`, one step practised outside the schedule. */
  | { name: 'study'; id: number; free?: Step }

/** A tapped word, shown in the word sheet. */
export interface WordPick {
  token: Token
  lessonId: number
  /** The sentence it came from: the card's context. */
  context: string
}

export interface App extends AppDeps {
  t: Strings
  updateSettings(patch: Partial<MacSettings>): void
  route: Route
  navigate(route: Route): void
  showWord(pick: WordPick | null): void
}

export const AppContext = createContext<App | null>(null)

export function useApp(): App {
  const app = useContext(AppContext)
  if (!app) throw new Error('useApp outside <App>')
  return app
}

/**
 * The result of `query`, re-run whenever the database changes (and when `deps` do). Only the
 * latest run's result is kept, and nothing is set after unmount. undefined until the first.
 */
export function useQuery<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const { db } = useApp()
  const [value, setValue] = useState<T | undefined>(undefined)
  useEffect(() => {
    let live = true
    let latest = 0
    const run = () => {
      const mine = ++latest
      query().then((v) => live && mine === latest && setValue(() => v))
    }
    run()
    const stop = db.onChange(run)
    return () => {
      live = false
      stop()
    }
    // The caller's deps say when `query` changes, as with useEffect.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [db, ...deps])
  return value
}

/** A lazily loaded resource (JMdict, accents): undefined while loading. */
export function useResource<T>(load: () => Promise<T>): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)
  useEffect(() => {
    let live = true
    load().then((v) => live && setValue(() => v))
    return () => {
      live = false
    }
  }, [load])
  return value
}

export type Children = { children?: ReactNode }
