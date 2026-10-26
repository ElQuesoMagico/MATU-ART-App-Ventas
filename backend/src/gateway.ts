import { sign } from './security.ts'
import type { Env } from './types.ts'
export async function probeSheets(env: Env, requestFetch: typeof fetch = fetch) {
  if (!env.GAS_SECRET || !/^[a-f0-9]{64}$/.test(env.GAS_SECRET) || !/^[a-zA-Z0-9_-]{1,32}$/.test(env.GAS_KEY_ID)) throw new Error('Gateway not configured')
  const url = new URL(env.GAS_URL)
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid gateway')
  const requestId = crypto.randomUUID()
  const payload = JSON.stringify({version:1,requestId,timestamp:Date.now(),operation:'metadata'})
  const signature = sign(`${env.GAS_KEY_ID}\n${payload}`, env.GAS_SECRET)
  // ContentService redirects the OUTPUT to googleusercontent. Never forward the
  // signed POST body to an arbitrary redirect destination.
  const signal = AbortSignal.timeout(12000)
  let response = await requestFetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyId:env.GAS_KEY_ID,payload,signature}),redirect:'manual',signal})
  if (response.status === 302 || response.status === 303) {
    const location = new URL(response.headers.get('Location') ?? '')
    if (location.origin !== 'https://script.googleusercontent.com') throw new Error('Unexpected gateway redirect')
    response = await requestFetch(location,{method:'GET',redirect:'error',signal})
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Gateway unavailable')
  const raw = await limitedText(response, 4096)
  const body = JSON.parse(raw)
  if (body.version !== 1 || body.requestId !== requestId || body.ok !== true || body.data?.schemaVersion !== 1 || typeof body.data?.ready !== 'boolean') throw new Error('Invalid gateway response')
  return {schemaVersion:1, ready:body.data.ready as boolean}
}
export async function limitedText(message: Request | Response, limit: number) {
  const reader = message.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []; let size = 0
  try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('Body too large') }; chunks.push(value) } }
  finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
