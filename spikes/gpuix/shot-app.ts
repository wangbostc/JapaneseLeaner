// Drives the compiled binary inside Kikitori.app (so bundle paths are exercised) and screenshots it.
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: '../build/Kikitori.app/Contents/MacOS/kikitori', args: [], env: { GPUIX_BACKGROUND: '1' } })
await app.getByText('Ready.').waitFor({ timeoutMs: 60_000 })
await app.getByTestId('ime').fill('きょうはいいてんきです')
await app.screenshot({ path: 'screenshots/app.png' })
await app.close()
console.log('wrote screenshots/app.png')
