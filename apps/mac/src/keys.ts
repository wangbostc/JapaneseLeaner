/** Window key presses (gpuix delivers them to render()), for parts of the UI that listen. */
export interface KeyEvents {
  subscribe(listener: (key: string) => void): () => void
  emit(key: string): void
}

export function keyEvents(): KeyEvents {
  const listeners = new Set<(key: string) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    emit(key) {
      for (const listener of [...listeners]) listener(key)
    },
  }
}
