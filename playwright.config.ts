import { defineConfig, devices } from '@playwright/test'

// Override when several checkouts run e2e at once, so none reuses another's server.
const port = Number(process.env.E2E_PORT ?? 4173)

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}/`,
    // Imported-audio tests play real media without a click-through gesture.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: { command: `pnpm build && pnpm preview --port ${port} --strictPort`, port, reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 } } },
  ],
})
