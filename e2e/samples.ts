import { readFileSync } from 'node:fs'

/** How many built-in lessons a fresh install starts with (packages/core/src/samples.json). */
export const SAMPLES = (JSON.parse(readFileSync(new URL('../packages/core/src/samples.json', import.meta.url), 'utf8')) as unknown[]).length
