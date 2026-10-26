import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { createHmac } from 'node:crypto'
import { handle } from '../backend/src/index.ts'
import type { Database, Env, Statement } from '../backend/src/types.ts'
import { passwordHash, digest, sign } from '../backend/src/security.ts'
import { probeSheets } from '../backend/src/gateway.ts'
import { cloudBase, createCloudClient } from '../src/services/cloud/client.ts'
import 'fake-indexeddb/auto'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'

const origin='https://matu.example.com', now=Date.now(), password='Test-only-password-8.1!'
const verifier=passwordHash(password)
class SQLite implements Database {
  db:DatabaseSync
  constructor(path=':memory:'){this.db=new DatabaseSync(path)}
  prepare(sql:string):Statement {
    const statement=this.db.prepare(sql); let values:(string|number|null)[]=[]
    return {bind(...args){values=args;return this},async first<T>(){return (statement.get(...values)??null) as T|null},async run(){return statement.run(...values)}}
  }
}
function setup(db=new SQLite()):Env {
  db.db.exec(readFileSync(new URL('../backend/migrations/0001_auth.sql',import.meta.url),'utf8'))
  for(const role of ['administrator','manager','seller']) db.db.prepare('INSERT INTO users VALUES(?,?,?,?,0,?)').run(role,role,verifier,role,now)
  return {DB:db,APP_ORIGIN:origin,GAS_URL:'',GAS_KEY_ID:'v1'}
}
function req(path:string,body?:unknown,cookie?:string,csrf?:string,extra:Record<string,string>={}) {
  return new Request(`${origin}/api${path}`,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)})
}
async function login(env:Env,username='administrator') {
  const response=await handle(req('/auth/login',{username,password}),env,now)
  assert.equal(response.status,200)
  return {cookie:response.headers.get('set-cookie')!.split(';')[0],data:(await response.json()).data}
}
test('cloud: salted password verifier, credentials, secure cookie and server roles',async()=>{
  assert.notEqual(passwordHash(password),verifier)
  const env=setup(), session=await login(env)
  assert.equal(session.data.user.role,'administrator')
  assert.equal('password_hash' in session.data.user,false)
  const raw=session.cookie.split('=')[1]
  const db=env.DB as SQLite
  assert.ok(db.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(digest(raw)))
  assert.equal(db.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(raw),undefined)
  const response=await handle(req('/auth/login',{username:'seller',password}),env,now)
  assert.match(response.headers.get('set-cookie')!,/HttpOnly; Secure; SameSite=Strict/)
  assert.equal((await response.json()).data.user.role,'seller')
  for(const username of ['administrator','missing']) assert.equal((await handle(req('/auth/login',{username,password:'incorrect'}),env,now)).status,401)
  assert.equal((await handle(req('/auth/login',{username:'seller',password,role:'administrator'}),env,now)).status,400)
})
test('cloud: unauthorized, expiry, logout and CSRF',async()=>{
  const env=setup(),s=await login(env)
  assert.equal((await handle(req('/auth/session'),env,now)).status,401)
  assert.equal((await handle(req('/auth/session',undefined,s.cookie),env,now+8*3600000)).status,401)
  assert.equal((await handle(req('/auth/logout',{},s.cookie),env,now)).status,403)
  assert.equal((await handle(req('/auth/logout',{},s.cookie,s.data.csrf),env,now)).status,200)
  assert.equal((await handle(req('/auth/session',undefined,s.cookie),env,now)).status,401)
})
test('cloud: roles enforced and disabled users lose existing sessions',async()=>{
  const env=setup()
  for(const role of ['administrator','manager','seller']) {
    const s=await login(env,role)
    const response=await handle(req('/connection/test',{},s.cookie,s.data.csrf),env,now,async()=>({schemaVersion:1,ready:true}))
    assert.equal(response.status,role==='seller'?403:200)
  }
  const s=await login(env)
  ;(env.DB as SQLite).db.exec("UPDATE users SET disabled=1 WHERE id='administrator'")
  assert.equal((await handle(req('/auth/session',undefined,s.cookie),env,now)).status,401)
})
test('cloud: malformed, oversized, foreign origin, CSRF and no public writes',async()=>{
  const env=setup()
  for(const body of [[],null,{username:'x',password:'a'},{username:'seller',password:'x'.repeat(5000)}]) assert.equal((await handle(req('/auth/login',body),env,now)).status,400)
  assert.equal((await handle(req('/auth/login',{username:'seller',password},undefined,undefined,{Origin:'https://evil.example'}),env,now)).status,403)
  assert.equal((await handle(new Request(`${origin}/api/auth/login`,{method:'POST',body:'{}'}),env,now)).status,403)
  assert.equal((await handle(req('/sync',{}),env,now)).status,404)
  const status=await handle(new Request(`${origin}/api/status`),env,now)
  assert.deepEqual(await status.json(),{version:1,ok:true,data:{status:'available',version:1}})
  assert.equal(status.headers.get('Cache-Control'),'no-store')
})
test('cloud: atomic persistent limits block parallel attempts and expire',async()=>{
  const env=setup()
  const results=await Promise.all(Array.from({length:7},()=>handle(req('/auth/login',{username:'seller',password:'bad'}),env,now)))
  assert.equal(results.filter(r=>r.status===401).length,5)
  assert.equal(results.filter(r=>r.status===429).length,2)
  assert.equal((await handle(req('/auth/login',{username:'seller',password}),env,now+900001)).status,200)
})
test('cloud: sessions survive process database reopen; server errors never expose details',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'matu-cloud-test-')),path=join(dir,'auth.sqlite')
  let db=new SQLite(path)
  try {
    const env=setup(db),s=await login(env);db.db.close();db=new SQLite(path);env.DB=db
    assert.equal((await handle(req('/auth/session',undefined,s.cookie),env,now)).status,200)
    const result=await handle(req('/connection/test',{},s.cookie,s.data.csrf),env,now,async()=>{throw new Error('secret-not-for-client')})
    assert.equal(result.status,502);assert.doesNotMatch(await result.text(),/secret-not/)
  }finally{db.db.close();rmSync(path);rmdirSync(dir)}
})
function gasRuntime(){
  const properties:Record<string,string>={GATEWAY_KEYS:JSON.stringify({v1:'a'.repeat(64)}),SPREADSHEET_ID:'private-sheet'}
  let reads=0
  const context=createContext({PropertiesService:{getScriptProperties:()=>({getProperty:(k:string)=>properties[k]??null,getProperties:()=>({...properties}),deleteProperty:(k:string)=>{delete properties[k]},setProperty:(k:string,v:string)=>{properties[k]=v}})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(message:string,secret:string)=>Array.from(createHmac('sha256',secret).update(message).digest())},ContentService:{MimeType:{JSON:'json'},createTextOutput:(text:string)=>({setMimeType:()=>JSON.parse(text)})},SpreadsheetApp:{openById:()=>{reads++;return {getSheetByName:()=>({getRange:()=>({getValues:()=>[['id','workspaceId','revision','updatedAt','operationId','payloadJson']]})})}}}})
  runInContext(readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context)
  return {context,reads:()=>reads,post:(body:unknown)=>context.doPost({postData:{type:'application/json',contents:JSON.stringify(body)}})}
}
function envelope(overrides={}){const payload=JSON.stringify({version:1,requestId:crypto.randomUUID(),timestamp:Date.now(),operation:'metadata',...overrides});return {keyId:'v1',payload,signature:sign(`v1\n${payload}`,'a'.repeat(64))}}
test('Apps Script real handler with mocked Google services rejects unsigned/tampered/stale/write/replay',()=>{
  const gas=gasRuntime()
  assert.equal(gas.context.doGet().ok,false)
  for(const body of [{},envelope({operation:'write'}),envelope({timestamp:0}),{...envelope(),signature:'0'.repeat(64)}]) assert.equal(gas.post(body).ok,false)
  assert.equal(gas.reads(),0)
  const body=envelope();assert.equal(gas.post(body).ok,true);assert.equal(gas.reads(),1)
  assert.equal(gas.post(body).ok,false);assert.equal(gas.reads(),1)
})
test('gateway signs payload, verifies response and only follows output redirect without secrets',async()=>{
  const env={...setup(),GAS_URL:'https://script.google.com/macros/s/test/exec',GAS_SECRET:'a'.repeat(64)}
  let requestId='',calls=0
  const send:typeof fetch=async(input,init)=>{
    calls++
    if(calls===1){const body=JSON.parse(String(init?.body));assert.equal(body.signature,sign(`v1\n${body.payload}`,env.GAS_SECRET));requestId=JSON.parse(body.payload).requestId;return new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/result'}})}
    assert.equal(String(input),'https://script.googleusercontent.com/result');assert.equal(init?.method,'GET');assert.equal(init?.body,undefined)
    return Response.json({version:1,ok:true,requestId,data:{schemaVersion:1,ready:true}})
  }
  assert.equal((await probeSheets(env,send)).ready,true)
  await assert.rejects(probeSheets(env,async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}})))
  await assert.rejects(probeSheets(env,async()=>Response.json({version:1,ok:true,requestId:'wrong',data:{schemaVersion:1,ready:true}})))
  await assert.rejects(probeSheets(env,async()=>{throw new Error('network')}))
})
test('cloud client stays memory-only, uses cookies, handles network and restricts backend origin',async()=>{
  assert.equal(cloudBase('',origin),'');assert.equal(cloudBase('/api',origin),origin+'/api')
  assert.throws(()=>cloudBase('https://evil.example/api',origin))
  assert.equal(cloudBase('http://localhost:8787/api','http://localhost:5173'),'http://localhost:8787/api')
  const client=createCloudClient(origin+'/api',async(_input,init)=>{assert.equal(init?.credentials,'include');assert.equal(init?.cache,'no-store');return Response.json({version:1,ok:true,data:{status:'available',version:1}})})
  assert.equal((await client.status()).status,'available')
  await assert.rejects(createCloudClient(origin,async()=>{throw new Error()}).status(),/Sin conexión/)
  await assert.rejects(createCloudClient('').status(),/no está configurada/)
  await assert.rejects(createCloudClient(origin,async()=>Response.json({version:1,ok:true,data:{user:{role:'administrator'}}})).session(),/No se pudo/)
})

test('cloud: login/logout do not touch IndexedDB; sale and persistence still work with fetch unavailable',async()=>{
  const name=`matu-auth-offline-${crypto.randomUUID()}`,catalog=new CatalogRepository(name),sales=new SalesRepository(name)
  const product=await catalog.createProduct({id:crypto.randomUUID(),name:'Local',categoryIds:[],price:1000,initialStock:7,initialCost:200,lowStockThreshold:2,isFavorite:false})
  const before=await catalog.snapshot(),env=setup(),s=await login(env)
  await handle(req('/auth/logout',{},s.cookie,s.data.csrf),env,now)
  assert.deepEqual(await catalog.snapshot(),before)
  const previousFetch=globalThis.fetch
  try {
    globalThis.fetch=async()=>{throw new Error('Offline')}
    const sale=await sales.confirm({operationId:crypto.randomUUID(),items:[{productId:product.id,quantity:1,unitPrice:1000,expectedRevision:product.revision}],payments:[{method:'cash',amount:1000}]})
    await catalog.close();await sales.close()
    const db=await openCatalogDatabase(name)
    assert.equal(db.version,10);assert.equal((await db.get('sales',sale.id))?.total,1000);assert.equal((await db.get('products',product.id))?.stock,6)
    db.close()
  }finally{globalThis.fetch=previousFetch;await catalog.close();await sales.close()}
})
