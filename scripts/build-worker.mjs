import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// The public client receives only a relative API path, never server credentials.
const env = { ...process.env, MATU_BASE_PATH: '/', VITE_CLOUD_API_URL: '/api' }
for (const args of [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build']]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const root = resolve('dist')
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
for (const [,url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('..') || !existsSync(resolve(root, url.slice(1)))) throw new Error(`Recurso inválido: ${url}`)
}
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.webmanifest'), 'utf8'))
if (manifest.scope !== './' || manifest.start_url !== './#inicio') throw new Error('Scope PWA incorrecto')
if (!existsSync(resolve(root, 'sw.js'))) throw new Error('Faltan recursos PWA')
console.log('Worker: frontend en / y API en /api. Compilación preparada; no desplegada.')
