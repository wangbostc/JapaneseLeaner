// Runs the compiled audio helper through every command that needs no microphone, silently:
//   bun scripts/helper-smoke.ts [path/to/kikitori-audio]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Helper, spawnHelper } from '../src/audio/helper'

const path = process.argv[2] ?? join(import.meta.dir, '../build/kikitori-audio')
const helper = new Helper(() => spawnHelper(path))
const dir = mkdtempSync(join(tmpdir(), 'kikitori-helper-'))
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`helper smoke: ${what}`)
  console.log(`ok  ${what}`)
}

const status = await helper.call('status').result
check(typeof status.voice === 'string', `status: voice ${status.voice}, mic ${status.mic}, speech ${status.speech}, on-device ${status.onDevice}`)

const said = await helper.call('speak', { text: 'はい。', rate: 1, volume: 0 }).result
check(said.stopped === false, 'speak ends when done')

const long = helper.call('speak', { text: '私は毎朝六時に起きます。まず、窓を開けて、コーヒーを飲みます。', rate: 1, volume: 0 })
await new Promise((r) => setTimeout(r, 200))
await helper.call('stop', { target: long.id }).result
check((await long.result).stopped === true, 'stop ends a running call as stopped')

const synth = join(dir, 'synth.caf')
await helper.call('synth', { text: '私は毎朝六時に起きます。', path: synth }).result
check((await Bun.file(synth).size) > 1000, 'synth writes speech to a file')

// One cue of the e2e fixture: plays from its start (seeking lands on a packet, so within 50 ms)
// and stops at its end.
const clip = join(import.meta.dir, '../../../e2e/fixtures/clip.wav')
const times: number[] = []
const started = Date.now()
const played = await helper.call('play', { path: clip, start: 0.5, end: 1.2, rate: 1, ticks: true, volume: 0 }, (e) => e.event === 'time' && times.push(e.t as number)).result
const took = Date.now() - started
check(played.stopped === false && times[0] >= 0.45 && times.at(-1)! >= 1.2 && times.at(-1)! < 1.3, `play stops at the cue end (${times[0]?.toFixed(2)}–${times.at(-1)?.toFixed(2)} s, ${took} ms)`)

const unknown = await helper.call('nope').result.then(() => 'ok', (e: Error) => e.message)
check(unknown === 'unknown command', 'an unknown command fails')
helper.dispose()
console.log('helper smoke passed')
