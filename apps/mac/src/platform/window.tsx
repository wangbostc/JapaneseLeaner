import { useGpuix } from '@gpuix/react'
import { useEffect, type ReactNode } from 'react'
import { dialog } from './dialog'

/** Hands the window's open dialog to platform/dialog.ts once the window exists. */
export function WindowBridge({ children }: { children: ReactNode }) {
  const { renderer } = useGpuix()
  useEffect(() => {
    dialog.open = renderer?.promptForPaths?.bind(renderer)
  }, [renderer])
  return children
}
