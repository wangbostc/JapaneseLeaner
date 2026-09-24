// Copies the kuromoji IPADIC dictionary into public/dict so Vite serves it
// as static files. The files stay gzipped; the loader sniffs the gzip magic
// bytes, so it works whether or not the server also sets Content-Encoding.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const src = join(dirname(require.resolve('kuromoji/package.json')), 'dict')
const dest = join(import.meta.dirname, '..', 'public', 'dict')

// kuromoji's NOTICE carries the IPADIC copyright and permission notice, which
// must accompany copies of the dictionary; the About screen links to it.
const licenses = join(import.meta.dirname, '..', 'public', 'licenses')
mkdirSync(licenses, { recursive: true })
cpSync(join(dirname(require.resolve('kuromoji/package.json')), 'NOTICE.md'), join(licenses, 'kuromoji-ipadic-NOTICE.txt'))

if (!existsSync(join(dest, 'base.dat.gz'))) {
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
  console.log(`copied kuromoji dict -> ${dest}`)
}
