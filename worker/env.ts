export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  /** Files too large for static assets (see scripts/large-assets.mjs), and later, imported audio. */
  FILES: R2Bucket
  /** The code a new device must present once to get a token. Set with `wrangler secret put SETUP_CODE`. */
  SETUP_CODE?: string
}
