/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Relative base + hash routing: the build runs from any static host path.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // public/manifest.webmanifest is ours; don't generate another.
      manifest: false,
      // Our own service worker (src/sw.ts): same caching as before, plus review reminders.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        // The 17 MB dictionary isn't precached on install; it's cached the first time
        // it's fetched. Opt-in features stay out of everyone's precache: the AI chunk needs
        // the network anyway, and the transcription worker + ONNX runtime are cached on first use.
        globIgnores: ['dict/**', '**/ai-*.js', '**/transcribe.worker-*.js'],
      },
    }),
  ],
  // kuromoji's loader joins dictionary paths with node's `path`.
  resolve: { alias: { path: 'path-browserify' } },
  optimizeDeps: { include: ['kuromoji/src/loader/DictionaryLoader', 'kuromoji/src/Tokenizer'] },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
  },
})
