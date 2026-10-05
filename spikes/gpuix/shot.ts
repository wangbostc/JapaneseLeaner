// Launches the spike in the background and writes screenshots/spike.png.
import { mkdirSync } from 'node:fs'
import { launch } from '@gpuix/react/automation'

mkdirSync('screenshots', { recursive: true })
const app = await launch({ command: 'bun', args: ['spike.tsx'], env: { GPUIX_BACKGROUND: '1' } })
await app.getByText('Ready.').waitFor({ timeoutMs: 60_000 })
await app.screenshot({ path: 'screenshots/spike.png' })
await app.close()
console.log('wrote screenshots/spike.png')
