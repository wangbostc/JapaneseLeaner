import { describe, expect, it } from 'vitest'
import { helperAudio } from './audio'
import { Helper, type HelperProcess } from './helper'

/** An in-process helper: each command is answered by `answer`, which can also send events. */
function fakeProcess(answer: (msg: Record<string, unknown>, send: (m: object) => void) => void) {
  const lines: ((l: string) => void)[] = []
  const exits: ((c: number | null) => void)[] = []
  const sent: Record<string, unknown>[] = []
  let alive = true
  const send = (m: object) => queueMicrotask(() => alive && lines.forEach((l) => l(JSON.stringify(m))))
  const proc: HelperProcess & { sent: typeof sent; die(): void } = {
    sent,
    send(line) {
      const msg = JSON.parse(line)
      sent.push(msg)
      answer(msg, send)
    },
    onLine: (l) => void lines.push(l),
    onExit: (l) => void exits.push(l),
    kill() {
      this.die()
    },
    die() {
      alive = false
      exits.forEach((e) => e(1))
    },
  }
  return proc
}

describe('audio helper client', () => {
  it('matches replies to calls by id, delivers events, and ignores lines that are not JSON', async () => {
    const proc = fakeProcess((m, send) => {
      send({ log: 'not a message' })
      if (m.cmd === 'play') {
        send({ event: 'time', id: m.id, t: 0.5 })
        send({ event: 'time', id: m.id, t: 1 })
      }
      send({ id: m.id, ok: true, cmd: m.cmd })
    })
    const helper = new Helper(() => proc)
    const times: number[] = []
    const audio = helperAudio(helper, () => '/tmp/x.caf')
    await Promise.all([audio.playFile('/a.wav', 0.5, 1, 1, undefined, (t) => times.push(t)), audio.speak('はい', 1)])
    expect(times).toEqual([0.5, 1])
    expect(proc.sent.map((m) => m.cmd)).toEqual(['play', 'speak'])
  })

  it('stops a call by its id when the signal aborts, and fails calls when the helper dies, then restarts it', async () => {
    let spawned = 0
    const procs: ReturnType<typeof fakeProcess>[] = []
    const helper = new Helper(() => {
      spawned++
      const proc = fakeProcess((m, send) => {
        if (m.cmd === 'stop') {
          send({ id: m.target, ok: true, stopped: true })
          send({ id: m.id, ok: true })
        }
        if (m.cmd === 'status') send({ id: m.id, ok: true, speech: 'authorized', recognizer: true, onDevice: false })
      })
      procs.push(proc)
      return proc
    })
    const audio = helperAudio(helper, () => '/tmp/x.caf')
    const abort = new AbortController()
    const speaking = audio.speak('長い文', 1, abort.signal)
    abort.abort()
    await speaking
    expect(procs[0].sent.at(-1)).toMatchObject({ cmd: 'stop', target: 1 })

    const hanging = audio.speak('もう一つ', 1)
    procs[0].die()
    await expect(hanging).rejects.toThrow('audio helper exited')
    expect(await audio.status()).toEqual({ canScore: true, onDevice: false })
    expect(spawned).toBe(2)
  })

  it('listens: started once the mic is live, interim text as it comes, then the final text and recording', async () => {
    const proc = fakeProcess((m, send) => {
      if (m.cmd === 'listen') {
        send({ event: 'listening', id: m.id })
        send({ event: 'interim', id: m.id, text: '私は' })
      }
      if (m.cmd === 'finish') {
        send({ id: m.target, ok: true, text: '私は毎朝6時に起きます', recording: m.target === 1 ? '/tmp/r1.caf' : null })
        send({ id: m.id, ok: true })
      }
    })
    const audio = helperAudio(new Helper(() => proc), () => '/tmp/r1.caf')
    const interim: string[] = []
    const listening = audio.listen((t) => interim.push(t))
    await listening.started
    expect(interim).toEqual(['私は'])
    expect(await listening.stop()).toEqual({ text: '私は毎朝6時に起きます', recording: '/tmp/r1.caf' })
    expect(proc.sent.find((m) => m.cmd === 'listen')).toMatchObject({ path: '/tmp/r1.caf' })
  })

  it('fails `started` when the mic cannot open', async () => {
    const proc = fakeProcess((m, send) => m.cmd === 'listen' && send({ id: m.id, ok: false, error: 'microphone permission denied' }))
    const listening = helperAudio(new Helper(() => proc), () => '/tmp/r.caf').listen(() => {})
    await expect(listening.started).rejects.toThrow('microphone permission denied')
  })
})
