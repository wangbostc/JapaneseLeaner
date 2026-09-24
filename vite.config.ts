/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base + hash routing: the build runs from any static host path.
  base: './',
  plugins: [react()],
  // kuromoji's loader joins dictionary paths with node's `path`.
  resolve: { alias: { path: 'path-browserify' } },
  optimizeDeps: { include: ['kuromoji/src/loader/DictionaryLoader', 'kuromoji/src/Tokenizer'] },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
