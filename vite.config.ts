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
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        // The 17 MB dictionary isn't precached on install; it's cached the
        // first time it's fetched, which every study session does.
        globIgnores: ['dict/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/dict/'),
            handler: 'CacheFirst',
            options: { // Versioned with kuromoji so a dictionary upgrade isn't masked by the old cache.
            cacheName: 'kuromoji-dict-0.1.2', expiration: { maxEntries: 20 } },
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
