import type { Env } from './env'

/**
 * Where scripts/private-lessons.mjs puts the learner's private lessons (the documents of the
 * local MongoDB's kikitori.privateLessons, as JSON). Outside /assets, so never served as a file.
 */
export const PRIVATE_LESSONS_KEY = 'private/lessons.json'

export const privateLessonsEnabled = (env: Env) => env.PRIVATE_LESSONS === '1'

/** The private lessons for a connected device: `{ docs }`, empty until any are uploaded. */
export async function privateLessons(env: Env): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  const object = await env.FILES.get(PRIVATE_LESSONS_KEY)
  if (!object) return new Response(JSON.stringify({ docs: [] }), { headers })
  return new Response(object.body, { headers })
}
