/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import jmdictRelease from './scripts/jmdict-release.json' with { type: 'json' }

export default defineConfig({
  // Relative base + hash routing: the build runs from any static host path.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // public/manifest.webmanifest is ours; don't generate another.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        // The 17 MB dictionary isn't precached on install; it's cached the
        // first time it's fetched, which every study session does.
        // Opt-in features stay out of everyone's precache: the AI chunk needs the network anyway,
        // and the transcription worker + ONNX runtime are cached on first use instead.
        globIgnores: ['dict/**', '**/ai-*.js', '**/transcribe.worker-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/(transcribe\.worker-[^/]+\.js|[^/]+\.wasm)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'asr-runtime', expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/dict/'),
            handler: 'CacheFirst',
            options: { // Versioned with kuromoji so a dictionary upgrade isn't masked by the old cache.
            cacheName: 'kuromoji-dict-0.1.2', expiration: { maxEntries: 20 } },
          },
          {
            // Word meanings, fetched on first use; the cache is named after the pinned release.
            urlPattern: ({ url }) => url.pathname.endsWith('/jmdict/common.json'),
            handler: 'CacheFirst',
            options: { cacheName: `jmdict-${jmdictRelease.version}`, expiration: { maxEntries: 2 } },
          },
        ],
        navigateFallback: 'index.html',
      },
    }),
  ],
  // kuromoji's loader joins dictionary paths with node's `path`.
  resolve: { alias: { path: 'path-browserify' } },
  optimizeDeps: { include: ['kuromoji/src/loader/DictionaryLoader', 'kuromoji/src/Tokenizer'] },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
