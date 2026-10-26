import type { CloudSession, CloudStatus, ConnectionResult } from './contracts'
import { z } from 'zod'
const sessionSchema = z.object({user:z.object({id:z.string().min(1),username:z.string().min(1),role:z.enum(['administrator','manager','seller'])}),csrf:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.iso.datetime()})
export class CloudError extends Error {
  code:string
  constructor(code:string) {
    const messages:Record<string,string> = {UNAUTHENTICATED:'La sesión venció o no está iniciada.',INVALID_CREDENTIALS:'Usuario o contraseña incorrectos.',RATE_LIMITED:'Demasiados intentos. Espera 15 minutos antes de volver a intentar.',FORBIDDEN:'Tu cuenta no tiene permiso para esta operación.',CONNECTION_FAILED:'No se pudo verificar Google Sheets. Revisa la configuración del servidor.',NETWORK:'Sin conexión con el servidor. Tus datos locales siguen disponibles.',NOT_CONFIGURED:'La conexión a la nube todavía no está configurada.',CSRF_DENIED:'Actualiza la sesión antes de continuar.'}
    super(messages[code] ?? 'No se pudo completar la solicitud. Revisa la conexión y la configuración.'); this.code=code
  }
}
export function cloudBase(raw:string, origin:string) {
  if (!raw.trim()) return ''
  const url = new URL(raw,origin)
  const local = new URL(origin).hostname === 'localhost' && url.hostname === 'localhost' && url.protocol === 'http:'
  if ((!local && (url.origin !== origin || url.protocol !== 'https:')) || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/,'') !== '/api') throw new Error('Usar /api en el mismo origen HTTPS (localhost permitido en desarrollo).')
  return url.href.replace(/\/$/,'')
}
export function createCloudClient(base:string, send:typeof fetch = fetch) {
  async function request<T>(schema:z.ZodType<T>,path:string,body?:unknown,csrf?:string):Promise<T> {
    if (!base) throw new CloudError('NOT_CONFIGURED')
    let response:Response
    try { response = await send(`${base}${path}`,{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),headers:body===undefined?{}:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)}) }
    catch { throw new CloudError('NETWORK') }
    let result
    try { result = await response.json() } catch { throw new CloudError('INVALID_RESPONSE') }
    if (result.version !== 1) throw new CloudError('INVALID_RESPONSE')
    if (!response.ok || !result.ok) throw new CloudError(result.error?.code ?? 'INVALID_RESPONSE')
    const parsed=schema.safeParse(result.data)
    if(!parsed.success)throw new CloudError('INVALID_RESPONSE')
    return parsed.data
  }
  return {status:()=>request<CloudStatus>(z.object({status:z.literal('available'),version:z.literal(1)}),'/status'),session:()=>request<CloudSession>(sessionSchema,'/auth/session'),login:(username:string,password:string)=>request<CloudSession>(sessionSchema,'/auth/login',{username,password}),logout:(csrf:string)=>request(z.object({signedOut:z.literal(true)}),'/auth/logout',{},csrf),test:(csrf:string)=>request<ConnectionResult>(z.object({schemaVersion:z.literal(1),ready:z.boolean()}),'/connection/test',{},csrf)}
}
