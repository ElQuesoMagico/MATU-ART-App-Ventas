import test from 'node:test'
import assert from 'node:assert/strict'
import { precachePaths, offlineWorkerSource } from '../offlinePlugin.ts'
import { runInNewContext } from 'node:vm'

test('offline precache includes lazy workers and artwork without duplicate requests',()=>{
  const paths=precachePaths(['index.html','assets/files.worker-abc.js','assets/restore.worker-def.js','assets/logo.png','favicon.svg'])
  assert.equal(new Set(paths).size,paths.length)
  assert.equal(paths.filter(path=>path==='index.html').length,1)
  assert.ok(paths.includes('assets/files.worker-abc.js'))
  assert.ok(paths.includes('assets/restore.worker-def.js'))
  assert.ok(paths.includes('assets/logo.png'))
  assert.ok(paths.includes('./'))
})

test('GitHub Pages scope isolates caches and does not intercept other projects or cloud',async()=>{
 const handlers:Record<string,(event:unknown)=>void>={},removed:string[]=[]
 let wait:Promise<unknown>|undefined,intercepted=false
 runInNewContext(offlineWorkerSource(['index.html','assets/app.js']),{
  URL,self:{registration:{scope:'https://user.github.io/matu/'},location:{origin:'https://user.github.io'},clients:{claim:async()=>{}},addEventListener:(type:string,handler:(event:unknown)=>void)=>{handlers[type]=handler}},
  caches:{keys:async()=>['matu-art-shell-%2Fmatu%2F-old','matu-art-shell-%2Fother%2F-old'],delete:async(key:string)=>{removed.push(key)},open:async()=>({match:async()=>'<html>MATU ART</html>'})},fetch:async()=>{throw new Error('offline')},
 })
 handlers.activate({waitUntil:(promise:Promise<unknown>)=>{wait=promise}});await wait
 assert.deepEqual(removed,['matu-art-shell-%2Fmatu%2F-old'])
 for(const url of ['https://user.github.io/other/','https://worker.workers.dev/api/session','https://user.github.io/api/status','https://user.github.io/matu/api/auth/session']){
  handlers.fetch({request:{url,method:'GET',mode:'navigate'},respondWith:()=>{intercepted=true}})
  assert.equal(intercepted,false)
 }
 handlers.fetch({request:{url:'https://user.github.io/matu/',method:'GET',mode:'navigate'},respondWith:()=>{intercepted=true}})
 assert.equal(intercepted,true)
})

test('offline module requests reuse public precache despite Vary: Origin; navigation has a fallback',async()=>{
  type FetchEvent={request:{url:string;method:string;mode:string};respondWith:(result:Promise<string>)=>void}
  const handlers:Record<string,(event:FetchEvent)=>void>={}
  runInNewContext(offlineWorkerSource(['index.html','assets/app.js']),{
    URL,
    self:{registration:{scope:'https://matu.test/'},location:{origin:'https://matu.test'},addEventListener:(type:string,handler:(event:FetchEvent)=>void)=>{handlers[type]=handler}},
    caches:{open:async()=>({match:async(request:string|FetchEvent['request'],options?:{ignoreVary:boolean})=>{
      if(request==='index.html')return '<html>MATU ART</html>'
      if(typeof request!=='string'&&request.url==='https://matu.test/assets/app.js'&&options?.ignoreVary)return 'cached module'
      return undefined
    }})},
    fetch:async()=>{throw new Error('offline')},
  })
  const request=(url:string,mode:string)=>new Promise<string>(resolve=>handlers.fetch({request:{url,method:'GET',mode},respondWith:result=>resolve(result)}))
  assert.equal(await request('https://matu.test/assets/app.js','cors'),'cached module')
  assert.equal(await request('https://matu.test/?new-navigation','navigate'),'<html>MATU ART</html>')
  let intercepted=false
  handlers.fetch({request:{url:'https://matu.test/api/auth/session',method:'GET',mode:'cors'},respondWith:()=>{intercepted=true}})
  assert.equal(intercepted,false,'authentication API must never use the shell cache or HTML fallback')
})
