import { defineConfig, devices } from '@playwright/test'

// Override when several checkouts run e2e at once, so none reuses another's server.
const port = Number(process.env.E2E_PORT ?? 4173)
// The real Worker (API + app) for the sync tests.
const workerPort = Number(process.env.E2E_WORKER_PORT ?? 8789)

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}/`,
    // Imported-audio tests play real media without a click-through gesture.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: [
    { command: `pnpm build && pnpm preview --port ${port} --strictPort`, port, reuseExistingServer: true, timeout: 120_000 },
    {
      command: `rm -rf .wrangler/e2e && E2E_PORT=${port} E2E_WORKER_PORT=${workerPort} node scripts/worker-e2e-server.mjs`,
      port: workerPort,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /sync\.spec/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 } }, testIgnore: /sync\.spec/ },
    {
      name: 'worker',
      testMatch: /sync\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${workerPort}/` },
    },
  ],
})
