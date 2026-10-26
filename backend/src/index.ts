import type { Account, Env, Role, Session } from './types.ts'
import { digest, dummyHash, equal, normalizeUsername, token, verifyPassword } from './security.ts'
import { limitedText, probeSheets } from './gateway.ts'

const COOKIE = '__Host-matu-session'
const TTL = 8 * 60 * 60 * 1000
class HttpError extends Error {
  status: number; code: string
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code }
}
function config(env: Env) {
  const origin = new URL(env.APP_ORIGIN)
  if (origin.origin !== env.APP_ORIGIN || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === 'localhost'))) throw new Error('Invalid origin')
  if (!env.DB?.prepare) throw new Error('Missing DB')
}
function sessionToken(request: Request) {
  return (request.headers.get('Cookie') ?? '').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1) ?? ''
}
function cookie(value: string, age: number) { return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}` }
function publicSession(row: Session) { return {user:{id:row.id,username:row.username,role:row.role},csrf:row.csrf,expiresAt:new Date(row.expires_at).toISOString()} }
export function permitted(role: Role, permission: 'connection:test') { return permission === 'connection:test' && (role === 'administrator' || role === 'manager') }
async function limit(env: Env, key: string, max: number, duration: number, now: number) {
  const row = await env.DB.prepare(`INSERT INTO attempts(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`).bind(key,now+duration,now,now).first<{count:number}>()
  if (!row || row.count > max) throw new HttpError(429,'RATE_LIMITED')
}
async function authenticated(request: Request, env: Env, now: number) {
  const raw = sessionToken(request)
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new HttpError(401,'UNAUTHENTICATED')
  const row = await env.DB.prepare(`SELECT u.*,s.csrf,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).bind(digest(raw),now).first<Session>()
  if (!row) throw new HttpError(401,'UNAUTHENTICATED')
  return row
}
async function jsonBody(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new HttpError(415,'JSON_REQUIRED')
  try { const body: unknown = JSON.parse(await limitedText(request,4096)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body as Record<string,unknown> }
  catch { throw new HttpError(400,'INVALID_REQUEST') }
}
export async function handle(request: Request, env: Env, now = Date.now(), gateway = probeSheets): Promise<Response> {
  let status = 200, data: unknown; let setCookie: string | undefined
  const headers = new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'})
  try {
    config(env)
    const url = new URL(request.url), path = url.pathname
    const origin = request.headers.get('Origin')
    if (origin && origin !== env.APP_ORIGIN) throw new HttpError(403,'ORIGIN_DENIED')
    if (origin === env.APP_ORIGIN) { headers.set('Access-Control-Allow-Origin',origin); headers.set('Access-Control-Allow-Credentials','true') }
    if (request.method === 'OPTIONS') {
      if (origin !== env.APP_ORIGIN) throw new HttpError(403,'ORIGIN_DENIED')
      headers.set('Access-Control-Allow-Methods','GET, POST'); headers.set('Access-Control-Allow-Headers','Content-Type, X-CSRF-Token')
      return new Response(null,{status:204,headers})
    }
    if (request.method === 'GET' && path === '/api/status') data = {status:'available',version:1}
    else {
      // Same-origin GET may omit Origin. Mutations ALWAYS require exact Origin.
      if (origin !== env.APP_ORIGIN && !(request.method === 'GET' && request.headers.get('Sec-Fetch-Site') === 'same-origin')) throw new HttpError(403,'ORIGIN_DENIED')
      if (request.method === 'POST' && path === '/api/auth/login') {
        const body = await jsonBody(request)
        if (Object.keys(body).sort().join(',') !== 'password,username' || typeof body.username !== 'string' || typeof body.password !== 'string') throw new HttpError(400,'INVALID_REQUEST')
        const username = normalizeUsername(body.username), password = body.password
        if (!/^[a-z0-9._@+-]{3,100}$/.test(username) || password.length < 1 || password.length > 256) throw new HttpError(400,'INVALID_REQUEST')
        // CF-Connecting-IP is supplied by Cloudflare; do not trust X-Forwarded-For.
        await limit(env,'login:global',120,60000,now)
        await limit(env,`login:ip:${digest(request.headers.get('CF-Connecting-IP') ?? 'local')}`,30,900000,now)
        await limit(env,`login:user:${digest(username)}`,5,900000,now)
        const user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first<Account>()
        const valid = verifyPassword(password,user?.password_hash ?? dummyHash)
        if (!user || !valid || user.disabled) throw new HttpError(401,'INVALID_CREDENTIALS')
        const raw = token(), csrf = token()
        // Rotate the current browser session; a user never supplies their role.
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(sessionToken(request))).run()
        await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)').bind(digest(raw),user.id,csrf,now+TTL,now).run()
        setCookie = cookie(raw,TTL/1000)
        data = publicSession({...user,csrf,expires_at:now+TTL})
      } else if (path === '/api/auth/session' && request.method === 'GET') {
        data = publicSession(await authenticated(request,env,now))
      } else if (request.method === 'POST' && (path === '/api/auth/logout' || path === '/api/connection/test')) {
        const session = await authenticated(request,env,now)
        const body = await jsonBody(request)
        if (Object.keys(body).length) throw new HttpError(400,'INVALID_REQUEST')
        if (!equal(request.headers.get('X-CSRF-Token') ?? '',session.csrf)) throw new HttpError(403,'CSRF_DENIED')
        if (path === '/api/auth/logout') {
          await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(sessionToken(request))).run()
          setCookie = cookie('',0); data = {signedOut:true}
        } else {
          if (!permitted(session.role,'connection:test')) throw new HttpError(403,'FORBIDDEN')
          await limit(env,`probe:${session.id}`,5,60000,now)
          try { data = await gateway(env) } catch { throw new HttpError(502,'CONNECTION_FAILED') }
        }
      } else throw new HttpError(404,'NOT_FOUND')
    }
  } catch (error) {
    status = error instanceof HttpError ? error.status : 503
    data = undefined
    if (status === 429) headers.set('Retry-After','900')
    if (status === 401) setCookie = cookie('',0)
    if (setCookie) headers.set('Set-Cookie',setCookie)
    return new Response(JSON.stringify({version:1,ok:false,error:{code:error instanceof HttpError ? error.code : 'SERVICE_UNAVAILABLE'}}),{status,headers})
  }
  if (setCookie) headers.set('Set-Cookie',setCookie)
  return new Response(JSON.stringify({version:1,ok:true,data}),{status,headers})
}
export default {
  fetch: (request: Request, env: Env) => handle(request,env),
  async scheduled(_event: unknown, env: Env) {
    const now = Date.now()
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now).run()
    await env.DB.prepare('DELETE FROM attempts WHERE expires_at<=?').bind(now).run()
  },
}
