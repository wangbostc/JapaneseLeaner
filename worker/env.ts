export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  /** Files too large for static assets (see scripts/large-assets.mjs), and later, imported audio. */
  FILES: R2Bucket
  /** The code a new device must present once to get a token. Set with `wrangler secret put SETUP_CODE`. */
  SETUP_CODE?: string
  /** Web Push (VAPID) keys, from scripts/vapid-keys.mjs; reminders are off until both are set. */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** The server's Anthropic API key (`wrangler secret put ANTHROPIC_API_KEY`); AI features are off without it. */
  ANTHROPIC_API_KEY?: string
  /** Only for tests: send Anthropic API calls to a fake server. */
  ANTHROPIC_BASE_URL?: string
  /** Contact for push services (mailto: or https:); defaults to the project URL. */
  VAPID_SUBJECT?: string
}
