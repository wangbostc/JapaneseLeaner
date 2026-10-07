// Runs the built app (in front, for a person to use) with automation on, and every 2 seconds
// writes what it shows and where everything is, to debug input:
//   bun scripts/inspect.ts <out dir>
// <out dir>/now.png      the window
// <out dir>/tree.json    every element, with its testId and bounds (window coordinates)
// <out dir>/clicks.log   every press and click: coordinates and the element hit
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from '@gpuix/react/automation'

const out = process.argv[2] ?? 'inspect'
mkdirSync(out, { recursive: true })
const data = mkdtempSync(join(tmpdir(), 'kikitori-inspect-'))
const app = await launch({
  command: join(import.meta.dir, '../build/Kikitori.app/Contents/MacOS/kikitori'),
  args: [],
  env: { KIKITORI_DATA_DIR: data, KIKITORI_CLICK_LOG: join(out, 'clicks.log') },
})
console.log(`inspecting (data: ${data}); stop with Ctrl-C`)
for (;;) {
  try {
    await app.screenshot({ path: join(out, 'now.png') })
    // The retained tree, with bounds (the client's own call, as its locators use).
    const { tree } = await (app as unknown as { call(m: string, p: object): Promise<{ tree: unknown }> }).call('getTree', {})
    writeFileSync(join(out, 'tree.json'), JSON.stringify(tree))
  } catch (e) {
    console.log(`app gone: ${e}`)
    break
  }
  await new Promise((r) => setTimeout(r, 2000))
}
