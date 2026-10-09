// The macOS app's entry: the only file that knows about the machine (paths, files, the window).
import { homedir } from 'node:os'
import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { render } from '@gpuix/react'
import { createExamples, type ExamplesData } from '@kikitori/core/examples'
import { createDictionary, type DictData } from '@kikitori/core/jmdict'
import { createAccentTable } from '@kikitori/core/pitch'
import { introduceCoreWords } from '@kikitori/core/coreWords'
import { addPrivateLessons } from '@kikitori/core/privateLessons'
import { seedOnce } from '@kikitori/core/seed'
import { createStore } from '@kikitori/core/store'
import { loadAnalyzer } from '@kikitori/core/tokenizer'
import { openBunDatabase } from '@kikitori/sqlite/bun'
import { App } from './App'
import { fakeAudio, helperAudio, type Audio } from './audio/audio'
import { Helper, spawnHelper } from './audio/helper'
import { engineVoices } from './audio/voices'
import { keyEvents } from './keys'
import { nodeFiles } from './platform/files'
import { mediaCache } from './platform/media'
import { filePrefs } from './platform/prefs'
import { readAudioFile, readPrivateLessons } from './platform/privateLessons'
import { promptForPaths } from './platform/dialog'
import { WindowBridge } from './platform/window'
import { readSettings } from './settings'

// Inside Kikitori.app, resources sit in Contents/Resources; from source, in the repo.
const bundled = Bun.isStandaloneExecutable
const repo = join(import.meta.dir, '../../..')
const resources = {
  dict: bundled ? join(dirname(process.execPath), '../Resources/dict') : join(dirname(Bun.resolveSync('kuromoji/package.json', import.meta.dir)), 'dict'),
  jmdict: bundled ? join(dirname(process.execPath), '../Resources/jmdict/common.json') : join(repo, 'public/jmdict/common.json'),
  examples: bundled ? join(dirname(process.execPath), '../Resources/jmdict/examples.json') : join(repo, 'public/jmdict/examples.json'),
  accents: bundled ? join(dirname(process.execPath), '../Resources/pitch/accents.json') : join(repo, 'public/pitch/accents.json'),
  helper: bundled ? join(dirname(process.execPath), 'kikitori-audio') : join(import.meta.dir, '../build/kikitori-audio'),
}

// KIKITORI_DATA_DIR keeps dev runs and automation away from the learner's real data.
const dataDir = process.env.KIKITORI_DATA_DIR ?? join(homedir(), 'Library/Application Support/Kikitori')
mkdirSync(dataDir, { recursive: true })

const once = <T,>(load: () => Promise<T>) => {
  let p: Promise<T> | undefined
  return () => (p ??= load())
}
const optionalJson = <T,>(path: string, make: (data: never) => T) =>
  once(async () => {
    try {
      return make((await Bun.file(path).json()) as never)
    } catch {
      return null // not built (JMdict comes from postinstall) or unreadable: the UI leaves it out
    }
  })

const dictionary = optionalJson(resources.jmdict, (data: DictData) => createDictionary(data))
// Example sentences only with the dictionary they were built for (null otherwise).
const examples = once(async () => {
  const data = await optionalJson(resources.examples, (data: ExamplesData) => data)()
  return createExamples(data, await dictionary())
})

const db = openBunDatabase(join(dataDir, 'kikitori.db'))

// Audio files of lessons (for the helper to play), named by uid; recordings of attempts.
const media = mediaCache(db, join(dataDir, 'media'))
await media.prune()
const recordingsDir = join(dataDir, 'recordings')
rmSync(recordingsDir, { recursive: true, force: true }) // last session's attempts
mkdirSync(recordingsDir, { recursive: true })

// The open dialog belongs to the window: <WindowBridge> hands it over once rendered.
const files = nodeFiles((options) => promptForPaths({ files: !options?.directories, directories: options?.directories, prompt: options?.prompt }))

// The real microphone and speech recognition only in the app bundle (or when asked for): asking
// for them from a terminal run would be attributed to the terminal, which can't grant them.
// KIKITORI_FAKE_AUDIO=1 keeps automation silent and permission-free, even in the bundle.
let recording = 0
const real = (bundled || process.env.KIKITORI_REAL_AUDIO === '1') && process.env.KIKITORI_FAKE_AUDIO !== '1'
const baseAudio: Audio = real
  ? helperAudio(new Helper(() => spawnHelper(resources.helper)), () => join(recordingsDir, `attempt-${++recording}.caf`))
  : fakeAudio(['私は毎朝六時に起きます。'])
// KIKITORI_LOG=1: what the recogniser heard, on stdout (to check a real session afterwards).
const audio: Audio =
  process.env.KIKITORI_LOG === '1'
    ? {
        ...baseAudio,
        status: () => baseAudio.status().then((s) => (console.log(`[audio] ${JSON.stringify(s)}`), s)),
        listen(onInterim) {
          const listening = baseAudio.listen(onInterim)
          return { ...listening, stop: () => listening.stop().then((h) => (console.log(`[heard] ${JSON.stringify(h)}`), h)) }
        },
      }
    : baseAudio
// Sentences made by AivisSpeech or VOICEVOX, kept for replays (not in `media`, which is pruned to
// lessons' audio, nor `recordings`, which each start clears).
const voices = engineVoices(join(dataDir, 'voices'))
await voices.prune()
const prefs = filePrefs(join(dataDir, 'prefs.json'))
const store = createStore(db)
// A failure leaves the samples for the next start: never a reason not to open.
await seedOnce(store, () => prefs).catch((e) => console.error('[seed]', e))
const settings = readSettings(prefs, Intl.DateTimeFormat().resolvedOptions().locale)
// Today's new core words, so Today counts them (Cards adds them too, if the day turns meanwhile).
await introduceCoreWords(db, settings.newWordsPerDay)
// The learner's private lessons from the local MongoDB (a textbook of their own), in the
// background: the app doesn't wait on MongoDB, and runs the same without it.
if (process.env.KIKITORI_PRIVATE_LESSONS !== '0') {
  void readPrivateLessons()
    .then((docs) => docs && addPrivateLessons(store, docs, readAudioFile, prefs))
    .then((r) => {
      if (!r) return
      if (r.added || r.updated || r.cards) console.log(`[private] ${r.added} added, ${r.updated} updated, ${r.cards} cards`)
      for (const p of r.problems) console.warn(`[private] ${p}`)
    })
    .catch((e) => console.error('[private]', e))
}
const analyzer = await loadAnalyzer((file) => Bun.file(join(resources.dict, file)).arrayBuffer())
const keys = keyEvents()

render(
  <WindowBridge>
    <App
      deps={{
        db,
        store,
        analyzer,
        dictionary,
        examples,
        accents: optionalJson(resources.accents, (data: { accents: Record<string, string> }) => createAccentTable(data)),
        settings,
        prefs,
        keys,
        audio,
        voices,
        files,
        mediaPath: media.path,
      }}
    />
  </WindowBridge>,
  {
    title: 'Kikitori',
    width: 980,
    height: 760,
    // The smallest the pages were checked at: narrower, they'd only get cramped.
    minWidth: 720,
    minHeight: 540,
    // Not a held key's repeats: holding 3 would grade card after card.
    onKeyDown: (event) => {
      if (!event.isHeld) keys.emit(event.key ?? '')
    },
    // KIKITORI_CLICK_LOG=<file>: every press and click, where it landed and on what (to debug input).
    ...(process.env.KIKITORI_CLICK_LOG
      ? {
          onEvent: (event: { eventType: string; elementId: number; x?: number; y?: number }) => {
            if (event.eventType === 'mouseDown' || event.eventType === 'click')
              appendFileSync(process.env.KIKITORI_CLICK_LOG!, JSON.stringify({ at: Date.now(), type: event.eventType, x: event.x, y: event.y, element: event.elementId }) + '\n')
          },
        }
      : {}),
    // Automation and screenshots run in the background, without taking the keyboard.
    focus: process.env.GPUIX_BACKGROUND !== '1',
  },
)
