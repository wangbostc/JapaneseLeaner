// The macOS app's entry: the only file that knows about the machine (paths, files, the window).
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { render } from '@gpuix/react'
import { createDictionary, type DictData } from '@kikitori/core/jmdict'
import { createAccentTable } from '@kikitori/core/pitch'
import { seedOnce } from '@kikitori/core/seed'
import { createStore } from '@kikitori/core/store'
import { loadAnalyzer } from '@kikitori/core/tokenizer'
import { openBunDatabase } from '@kikitori/sqlite/bun'
import { App } from './App'
import { keyEvents } from './keys'
import { filePrefs } from './platform/prefs'
import { readSettings } from './settings'

// Inside Kikitori.app, resources sit in Contents/Resources; from source, in the repo.
const bundled = Bun.isStandaloneExecutable
const repo = join(import.meta.dir, '../../..')
const resources = {
  dict: bundled ? join(dirname(process.execPath), '../Resources/dict') : join(dirname(Bun.resolveSync('kuromoji/package.json', import.meta.dir)), 'dict'),
  jmdict: bundled ? join(dirname(process.execPath), '../Resources/jmdict/common.json') : join(repo, 'public/jmdict/common.json'),
  accents: bundled ? join(dirname(process.execPath), '../Resources/pitch/accents.json') : join(repo, 'public/pitch/accents.json'),
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

const db = openBunDatabase(join(dataDir, 'kikitori.db'))
const prefs = filePrefs(join(dataDir, 'prefs.json'))
const store = createStore(db)
await seedOnce(store, () => prefs)
const analyzer = await loadAnalyzer((file) => Bun.file(join(resources.dict, file)).arrayBuffer())
const keys = keyEvents()
const locale = Intl.DateTimeFormat().resolvedOptions().locale

render(
  <App
    deps={{
      db,
      store,
      analyzer,
      dictionary: optionalJson(resources.jmdict, (data: DictData) => createDictionary(data)),
      accents: optionalJson(resources.accents, (data: { accents: Record<string, string> }) => createAccentTable(data)),
      settings: readSettings(prefs, locale),
      keys,
    }}
  />,
  {
    title: 'Kikitori',
    width: 980,
    height: 760,
    onKeyDown: (event) => keys.emit(event.key ?? ''),
    // Automation and screenshots run in the background, without taking the keyboard.
    focus: process.env.GPUIX_BACKGROUND !== '1',
  },
)
