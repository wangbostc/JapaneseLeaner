/**
 * Which onnxruntime-web build to load. Mirrors transformers.js
 * (src/backends/onnx.js): the asyncify build by default, the plain build on
 * Safari below 26 without WebGPU, where upstream disables asyncify. We set
 * wasmPaths ourselves (to serve the runtime from our origin), which skips
 * upstream's choice, so we make the same one here.
 */
export function pickAsyncifyBuild(nav: { userAgent: string; vendor?: string; gpu?: unknown }): boolean {
  return !(isSafariBelow26(nav) && !nav.gpu)
}

function isSafariBelow26({ userAgent, vendor = '' }: { userAgent: string; vendor?: string }): boolean {
  const isSafari =
    vendor.includes('Apple') &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i.test(userAgent) &&
    !userAgent.includes('Chrome') &&
    !userAgent.includes('Android')
  if (!isSafari) return false
  const match = /Version\/(\d+)/.exec(userAgent)
  // Missing or unparseable version: assume a modern Safari, as upstream does.
  return match ? Number(match[1]) < 26 : false
}
