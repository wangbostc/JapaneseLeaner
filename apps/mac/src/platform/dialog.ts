import type { NativeRenderer } from '@gpuix/react'

/** The window's open dialog, handed over by <WindowBridge> once the window exists. */
export const dialog: { open?: NativeRenderer['promptForPaths'] } = {}

/** Opens the system's file dialog; null when cancelled (or before the window exists). */
export const promptForPaths: NonNullable<NativeRenderer['promptForPaths']> = async (options) => (await dialog.open?.(options)) ?? null
