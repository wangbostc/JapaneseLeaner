import { defineConfig } from 'vitest/config'

// Separate from the web app's config: JSX here compiles for gpuix, not React DOM.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: '@gpuix/react' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
})
