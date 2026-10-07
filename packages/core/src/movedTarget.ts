/**
 * The new address the old static build points at (VITE_MOVED_TO). Empty means "not moved".
 * Anything else must be an absolute http(s) URL: a bare host would become a relative link
 * under the Pages path, and a `javascript:` URL would run in the page.
 */
export function movedTarget(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`VITE_MOVED_TO must be an absolute http(s) URL, got ${JSON.stringify(value)}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`VITE_MOVED_TO must be an http(s) URL, got ${JSON.stringify(value)}`)
  }
  return url.href
}
