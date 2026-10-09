// Builds apps/mac/assets/AppIcon.icns from icon.svg (and icon-small.svg for 16 and 32 px), with
// Chromium (Playwright's, already a dev dependency) to draw them and macOS's iconutil to pack
// them. Run by hand after changing either SVG; the .icns is committed, so building the app needs
// neither. Usage: bun apps/mac/scripts/build-icon.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const assets = join(import.meta.dir, '../assets')
const svg = (name: string) => readFileSync(join(assets, name), 'utf8')
const [full, small] = [svg('icon.svg'), svg('icon-small.svg')]

// An iconset's files: each size at 1x and 2x. 16 and 32 px pixels get the simplified drawing.
const FILES: [string, number][] = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

const iconset = join(mkdtempSync(join(tmpdir(), 'kikitori-icon-')), 'AppIcon.iconset')
execFileSync('mkdir', ['-p', iconset])
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const [file, px] of FILES) {
    await page.setViewportSize({ width: px, height: px })
    const drawing = (px <= 32 ? small : full).replace(/width="1024" height="1024"/, `width="${px}" height="${px}"`)
    await page.setContent(`<html><body style="margin:0;background:transparent">${drawing}</body></html>`)
    await page.screenshot({ path: join(iconset, file), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } })
  }
} finally {
  await browser.close()
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(assets, 'AppIcon.icns')])
rmSync(join(iconset, '..'), { recursive: true, force: true })
console.log(`wrote ${join(assets, 'AppIcon.icns')}`)
