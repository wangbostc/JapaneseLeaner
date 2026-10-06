// Runs the app in the background against a throwaway data folder and saves screenshots:
//   bun scripts/shot.ts [command...]   (default: the app from source)
// e.g. `bun scripts/shot.ts build/Kikitori.app/Contents/MacOS/kikitori` for the built app.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from '@gpuix/react/automation'

const [command = 'bun', ...args] = process.argv.length > 2 ? process.argv.slice(2) : ['bun', 'src/main.tsx']
const out = 'screenshots'
mkdirSync(out, { recursive: true })
const data = mkdtempSync(join(tmpdir(), 'kikitori-shot-'))
const app = await launch({ command, args, env: { GPUIX_BACKGROUND: '1', KIKITORI_DATA_DIR: data, KIKITORI_FAKE_AUDIO: '1' } })
try {
  await app.getByTestId('due').waitFor({ timeoutMs: 60_000 })
  await app.screenshot({ path: `${out}/today.png` })
  await app.getByTestId('lesson-1').click()
  await app.getByTestId('transcript').waitFor({ timeoutMs: 10_000 })
  await app.screenshot({ path: `${out}/lesson.png` })
  await app.getByTestId('word-0-2').click()
  await app.getByTestId('word-sheet').waitFor({ timeoutMs: 10_000 })
  await app.getByTestId('meanings').waitFor({ timeoutMs: 20_000 })
  await app.screenshot({ path: `${out}/word.png` })
  await app.getByTestId('close-sheet').click()
  await app.getByTestId('start').click()
  await app.getByTestId('conceal').waitFor({ timeoutMs: 10_000 })
  await app.screenshot({ path: `${out}/study.png` })
  console.log(`screenshots in ${out}/ (data: ${data})`)
} finally {
  await app.close()
}
