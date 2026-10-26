import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const base = process.env.MATU_BASE_PATH
if (!base || !/^\/(?:[A-Za-z0-9_.-]+\/)?$/.test(base) || base.includes('..')) {
  throw new Error('Configura MATU_BASE_PATH=/NOMBRE-DEL-REPOSITORIO/ o / para un sitio de usuario.')
}
// Explicitly offline-only Pages build, even if a developer has cloud settings locally.
const env = { ...process.env, VITE_CLOUD_API_URL: '' }
for (const args of [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build']]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const root = resolve('dist'), html = readFileSync(resolve(root, 'index.html'), 'utf8')
function asset(path) {
  if (!path || path.includes('..') || path.startsWith('/') || /^[a-z]+:/i.test(path)) throw new Error(`Ruta no local: ${path}`)
  if (!existsSync(resolve(root, path))) throw new Error(`Recurso ausente: ${path}`)
}
for (const [,url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (!url.startsWith(base)) throw new Error(`Ruta fuera de la base de Pages: ${url}`)
  asset(url.slice(base.length))
}
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.webmanifest'), 'utf8'))
if (manifest.scope !== './' || manifest.start_url !== './#inicio') throw new Error('Scope PWA incorrecto')
for (const icon of manifest.icons) asset(icon.src)
let precached = []
const handlers = {}
runInNewContext(readFileSync(resolve(root, 'sw.js'), 'utf8'), {
  URL,
  self: { registration: { scope: `https://pages.invalid${base}` }, addEventListener: (name, handler) => { handlers[name] = handler } },
  caches: { open: async () => ({ addAll: async paths => { precached = paths } }) },
})
let installed
handlers.install({ waitUntil: promise => { installed = promise } })
await installed
for (const path of precached) if (path !== './') asset(path)
if (!precached.includes('manifest.webmanifest')) throw new Error('Manifiesto fuera de la caché')
console.log(`Pages verificado: ${base}, ${precached.length} recursos locales, manifiesto y caché. No publicado.`)
