// The built-in lessons live in MongoDB (database `kikitori`, collection `lessons`) and are
// exported into packages/core/src/samples.json, which is committed: the app is a static bundle, and
// each browser adds samples it hasn't had yet on startup (src/lib/seed.ts). Run by hand after
// editing lessons in MongoDB:
//
//   node scripts/lessons.mjs export   # MongoDB → packages/core/src/samples.json
//   node scripts/lessons.mjs import   # packages/core/src/samples.json → MongoDB: adds the lessons it lacks
//
// MONGO_URL defaults to the local server. A lesson document:
//
//   { title: '私の朝', level: 'N5', lines: [{ ja: '…', en: '…', zh: '…' }, …] }
//
// The title is the sample's identity on every device (uid `sample:<title>`), so titles are
// unique, and renaming a lesson makes it a new sample. Devices that already have a sample keep
// it when it is edited or removed here: only new titles reach them.
//
// Private lessons (a textbook of the learner's own, like Genki) live in `privateLessons`, which
// this script never reads: samples.json is public. The macOS app reads those itself
// (@kikitori/core/privateLessons). A lesson here that looks like one stops the export.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1']
const FILE = join(import.meta.dirname, '..', 'packages/core/src/samples.json')
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017'

/** Throws listing every problem, so one run shows all that needs fixing. */
function check(lessons) {
  const problems = []
  const seen = new Set()
  for (const [i, l] of lessons.entries()) {
    const hasTitle = typeof l.title === 'string' && l.title.trim() !== ''
    const name = hasTitle ? l.title : `#${i + 1}`
    if (!hasTitle) problems.push(`${name}: missing title`)
    else if (seen.has(l.title)) problems.push(`${name}: duplicate title`)
    seen.add(l.title)
    if (!LEVELS.includes(l.level)) problems.push(`${name}: level must be one of ${LEVELS.join(', ')}, got ${JSON.stringify(l.level)}`)
    if (!Array.isArray(l.lines) || !l.lines.length) problems.push(`${name}: no lines`)
    for (const [j, line] of (Array.isArray(l.lines) ? l.lines : []).entries()) {
      for (const key of ['ja', 'en', 'zh']) {
        if (typeof line?.[key] !== 'string' || !line[key].trim()) problems.push(`${name}: line ${j + 1} is missing "${key}"`)
      }
    }
  }
  if (problems.length) throw new Error(`invalid lessons:\n  ${problems.join('\n  ')}`)
}

const plain = (l) => ({ title: l.title, level: l.level, lines: l.lines.map(({ ja, en, zh }) => ({ ja, en, zh })) })

const perLevel = (lessons) => LEVELS.map((lv) => `${lv} ${lessons.filter((l) => l.level === lv).length}`).join(', ')

/** Fields only a private lesson has, and the books whose text mustn't be published. */
const PRIVATE_FIELDS = ['book', 'chapter', 'label', 'audio', 'vocab', 'private']
const PRIVATE_TITLE = /genki|げんき|ゲンキ|tobira|とびら|トビラ/i

/** Throws naming any lesson that looks private, before anything is written to samples.json. */
function refusePrivate(docs) {
  // NFKC: full-width ＧＥＮＫＩ reads as GENKI.
  const found = docs.filter((d) => PRIVATE_FIELDS.some((f) => f in d) || PRIVATE_TITLE.test((d.title ?? '').normalize('NFKC')))
  if (found.length)
    throw new Error(
      `not exported: ${found.map((d) => d.title).join(', ')} look like private lessons, and samples.json is public. Keep them in the privateLessons collection.`,
    )
}

async function exportLessons(lessons) {
  // Easiest first, then in the order they were added: a fresh install seeds them in this order.
  const docs = await lessons.find().sort({ _id: 1 }).toArray()
  refusePrivate(docs)
  const out = docs.map(plain).sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
  check(out)
  writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n')
  console.log(`wrote ${out.length} lessons (${perLevel(out)}) to packages/core/src/samples.json`)
}

async function importLessons(lessons) {
  const file = JSON.parse(readFileSync(FILE, 'utf8'))
  check(file)
  await lessons.createIndex({ title: 1 }, { unique: true })
  const now = new Date()
  let added = 0
  for (const l of file) {
    const { title, level, lines } = plain(l)
    // Never overwrites: MongoDB is the source of truth, and the file may be older than it.
    const res = await lessons.updateOne({ title }, { $setOnInsert: { level, lines, createdAt: now, updatedAt: now } }, { upsert: true })
    added += res.upsertedCount
  }
  console.log(`added ${added} of ${file.length} lessons to ${MONGO_URL} (the rest were already there)`)
}

const command = process.argv[2]
if (command !== 'export' && command !== 'import') throw new Error('usage: node scripts/lessons.mjs export|import')
const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 })
try {
  await client.connect()
  const lessons = client.db(process.env.MONGO_DB ?? 'kikitori').collection('lessons')
  await (command === 'export' ? exportLessons(lessons) : importLessons(lessons))
} finally {
  await client.close()
}
