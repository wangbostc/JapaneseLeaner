// The client for the Swift audio helper (apps/mac/helper): one JSON message per line.
//   → {"id": 3, "cmd": "speak", "text": "…", "rate": 1}
//   ← {"event": "time", "id": 3, "t": 1.2}          (events: listening, interim, time)
//   ← {"id": 3, "ok": true, "stopped": false}       (each command ends exactly once)
//   ← {"id": 3, "ok": false, "error": "…"}

export interface HelperProcess {
  send(line: string): void
  onLine(listener: (line: string) => void): void
  onExit(listener: (code: number | null) => void): void
  kill(): void
}

export interface HelperEvent {
  event: string
  id: number
  [key: string]: unknown
}
export interface HelperReply {
  id: number
  ok: boolean
  error?: string
  [key: string]: unknown
}

export class HelperError extends Error {}

/** A call in flight: its id (to stop it) and its one result. */
export interface Call {
  id: number
  result: Promise<HelperReply>
}

/**
 * Talks to the helper process, starting it on first use and again after it exits (everything
 * pending when it dies is rejected, so no caller waits forever).
 */
export class Helper {
  private proc: HelperProcess | null = null
  private next = 1
  private pending = new Map<number, { resolve(r: HelperReply): void; reject(e: Error): void; onEvent?(e: HelperEvent): void }>()
  private readonly start: () => HelperProcess

  constructor(start: () => HelperProcess) {
    this.start = start
  }

  private ensure(): HelperProcess {
    if (this.proc) return this.proc
    const proc = this.start()
    this.proc = proc
    proc.onLine((line) => this.receive(line))
    proc.onExit((code) => {
      if (this.proc !== proc) return
      this.proc = null
      const waiting = [...this.pending.values()]
      this.pending.clear()
      for (const p of waiting) p.reject(new HelperError(`audio helper exited (${code ?? 'killed'})`))
    })
    return proc
  }

  private receive(line: string) {
    let msg: HelperEvent | HelperReply
    try {
      msg = JSON.parse(line)
    } catch {
      return // not ours (a framework's log line)
    }
    const waiting = this.pending.get(msg.id)
    if (!waiting) return // a late reply for a call already settled
    if ('event' in msg) return waiting.onEvent?.(msg as HelperEvent)
    this.pending.delete(msg.id)
    if (msg.ok) waiting.resolve(msg)
    else waiting.reject(new HelperError(msg.error ?? 'audio helper error'))
  }

  /** Sends a command; `onEvent` hears its events until it ends. */
  call(cmd: string, args: Record<string, unknown> = {}, onEvent?: (e: HelperEvent) => void): Call {
    const id = this.next++
    const result = new Promise<HelperReply>((resolve, reject) => this.pending.set(id, { resolve, reject, onEvent }))
    try {
      this.ensure().send(JSON.stringify({ id, cmd, ...args }) + '\n')
    } catch (e) {
      this.pending.delete(id)
      return { id, result: Promise.reject(e instanceof Error ? e : new HelperError(String(e))) }
    }
    return { id, result }
  }

  dispose() {
    this.proc?.kill()
  }
}

/** The helper as a child process (Bun). */
export function spawnHelper(path: string, args: string[] = []): HelperProcess {
  const proc = Bun.spawn([path, ...args], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  const lineListeners: ((line: string) => void)[] = []
  // Read to the end; exit listeners wait for it, so a reply sent just before exiting still lands.
  const drained = (async () => {
    const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        for (const l of lineListeners) l(line)
      }
    }
  })().catch(() => {}) // a broken pipe ends the helper like an exit
  return {
    send(line) {
      proc.stdin.write(line)
      proc.stdin.flush()
    },
    onLine: (l) => void lineListeners.push(l),
    onExit: (l) => void Promise.all([proc.exited, drained]).then(([code]) => l(code)),
    kill: () => proc.kill(),
  }
}
