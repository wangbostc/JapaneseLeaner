import { authenticate, registerDevice, type Device } from './auth'
import type { Env } from './env'

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
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/')) return handleApi(request, env)
    // Routed here first by run_worker_first: R2 holds the files too big for static assets.
    // (The SPA fallback would answer a missing file with index.html, so R2 must go first.)
    if (pathname.startsWith('/assets/') && pathname.endsWith('.wasm')) {
      const large = await serveLargeAsset(env, pathname)
      if (large) return large
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
