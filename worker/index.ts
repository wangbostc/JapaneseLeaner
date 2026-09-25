import { authenticate, registerDevice, type Device } from './auth'
import type { Env } from './env'
import { sendDueReminders, subscribe } from './push'
import { BadRequest, getMedia, parseSyncRequest, putMedia, sync } from './sync'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const error = (status: number, message: string) => json({ error: message }, status)

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type Handler = (request: Request, env: Env, device: Device, params: string[]) => Promise<Response>

/** Authenticated routes: method + path pattern. */
const routes: [string, RegExp, Handler][] = [
  [
    'POST',
    /^\/api\/sync$/,
    async (req, env) => {
      try {
        return json(await sync(env, parseSyncRequest(await readJson(req))))
      } catch (e) {
        if (e instanceof BadRequest) return error(400, e.message)
        throw e
      }
    },
  ],
  ['GET', /^\/api\/push\/key$/, async (_req, env) => (env.VAPID_PUBLIC_KEY ? json({ key: env.VAPID_PUBLIC_KEY }) : error(503, 'push is not configured'))],
  ['POST', /^\/api\/push\/subscriptions$/, async (req, env, device) => subscribe(env, device.id, await readJson(req))],
  [
    'DELETE',
    /^\/api\/push\/subscriptions$/,
    async (req, env) => {
      const body = await readJson(req)
      if (typeof body?.endpoint === 'string') await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(body.endpoint).run()
      return json({ unsubscribed: true })
    },
  ],
  ['PUT', /^\/api\/media\/([\w:-]+)$/, (req, env, _device, [uid]) => putMedia(env, uid, req)],
  ['GET', /^\/api\/media\/([\w:-]+)$/, (_req, env, _device, [uid]) => getMedia(env, uid)],
  ['GET', /^\/api\/me$/, async (_req, _env, device) => json({ device })],
  [
    'GET',
    /^\/api\/devices$/,
    async (_req, env) => {
      const { results } = await env.DB.prepare('SELECT id, name, created_at, last_seen_at FROM devices ORDER BY created_at').all()
      return json({ devices: results })
    },
  ],
  [
    'DELETE',
    /^\/api\/devices\/([\w-]+)$/,
    async (_req, env, _device, [id]) => {
      const { meta } = await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id).run()
      return meta.changes ? json({ deleted: id }) : error(404, 'no such device')
    },
  ],
]

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (pathname === '/api/health' && request.method === 'GET') return json({ ok: true })

  if (pathname === '/api/devices' && request.method === 'POST') {
    const body = await readJson(request)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const result = await registerDevice(env, ip, body?.setupCode, body?.name)
    return result.ok ? json({ device: result.device, token: result.token }, 201) : error(result.status, result.error)
  }

  const device = await authenticate(env, request)
  if (!device) return error(401, 'unauthorized')
  for (const [method, pattern, handler] of routes) {
    const m = pattern.exec(pathname)
    if (m && request.method === method) return handler(request, env, device, m.slice(1))
  }
  return error(404, 'not found')
}

/** Build files over the static-asset size cap live in R2 under the same path; names are content-hashed. */
async function serveLargeAsset(env: Env, pathname: string): Promise<Response | null> {
  const object = await env.FILES.get(pathname.slice(1))
  if (!object) return null
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: object.httpEtag,
    },
  })
}

export default {
  // Cron Trigger (wrangler.jsonc): push reminders for reviews that have come due.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sendDueReminders(env))
  },
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/')) return handleApi(request, env)
    // Routed here first by run_worker_first: R2 holds the files too big for static assets.
    // (The SPA fallback would answer a missing file with index.html, so R2 must go first.)
    if (pathname.startsWith('/assets/') && pathname.endsWith('.wasm')) {
      const large = await serveLargeAsset(env, pathname)
      if (large) return large
      // Never let the SPA fallback answer for a wasm file: the service worker would cache the HTML.
      const asset = await env.ASSETS.fetch(request)
      return asset.headers.get('content-type')?.includes('wasm') ? asset : new Response('Not found', { status: 404 })
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
