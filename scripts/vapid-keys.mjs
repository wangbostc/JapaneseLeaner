// Generates a VAPID key pair for Web Push. Store the output as Worker secrets:
//   node scripts/vapid-keys.mjs
//   pnpm exec wrangler secret put VAPID_PUBLIC_KEY    (paste the public key)
//   pnpm exec wrangler secret put VAPID_PRIVATE_KEY   (paste the private JWK JSON)
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
console.log('VAPID_PUBLIC_KEY =', b64url(raw))
console.log('VAPID_PRIVATE_KEY =', JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)))
