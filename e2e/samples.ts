import { readFileSync } from 'node:fs'

/** How many built-in lessons a fresh install starts with (src/content/samples.json). */
export const SAMPLES = (JSON.parse(readFileSync(new URL('../src/content/samples.json', import.meta.url), 'utf8')) as unknown[]).length
