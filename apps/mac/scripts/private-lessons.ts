// Checks the private lessons in the local MongoDB (kikitori.privateLessons) before the macOS app
// adds them: what each will become, and what's wrong with any that can't be used. Reads only.
//   bun apps/mac/scripts/private-lessons.ts
// KIKITORI_MONGO_URL and KIKITORI_MONGO_DB point elsewhere, as for the app.
import { checkPrivateLessons, labelOf } from '@kikitori/core/privateLessons'
import { audioFiles, readPrivateLessons } from '../src/platform/privateLessons'

const read = await readPrivateLessons()
if ('error' in read) {
  console.error(`can't read the private lessons from ${process.env.KIKITORI_MONGO_URL ?? 'mongodb://127.0.0.1:27017'}: ${read.error}`)
  process.exit(1)
}
const docs = read.docs
const { lessons, problems } = checkPrivateLessons(docs)
console.log(`${docs.length} documents: ${lessons.length} usable`)
for (const l of lessons) {
  const timed = l.lines.every((x) => x.start !== undefined && x.end !== undefined)
  const audio = !l.audio ? 'read aloud' : !timed ? 'read aloud (audio needs start and end on every line)' : (await audioFiles.stamp(l.audio)) ? 'with audio' : `read aloud (can't read ${l.audio})`
  console.log(`- ${labelOf(l) ?? '(no label)'} · ${l.title}: ${l.lines.length} lines, ${audio}, ${l.vocab?.length ?? 0} words`)
}
for (const p of problems) console.log(`! ${p}`)
process.exit(problems.length ? 1 : 0)
