// Entry for the compiled app. `bun build --compile` doesn't embed gpuix's native renderer, so
// Kikitori.app ships it in Contents/Frameworks; point the napi-rs loader at it before anything
// imports @gpuix/native.
import { dirname, join } from 'node:path'

if (Bun.isStandaloneExecutable) {
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH ??= join(dirname(process.execPath), '../Frameworks/gpuix-native.darwin-arm64.node')
}
await import('./main')
