import { firebaseConnection } from './client'
import { flush, localView, reconcile } from './catalogLocal'
import type { RemoteRecord } from './catalogModel'
import type { FirebaseRole } from './access'
let stop: (()=>void)|undefined, generation=0
let remote:Record<string,RemoteRecord>|undefined
let error='',busy=false
let identity='',wake:(()=>void)|undefined
export const catalogStatus=()=>({error,busy,remote,automatic:!!identity})
export function reportCatalogError(message:string){error=message}
export function stopCatalog(){generation++;stop?.();stop=undefined;wake=undefined;identity='';remote=undefined;busy=false;error=''}
export function startOfflineCatalog(uid:string){
  stopCatalog();const epoch=generation
  const tick=async()=>{
    try{await navigator.locks.request('matu-catalog-sync',async()=>{
      if(epoch!==generation)return
      const view=await localView();if(view.state?.ownerUid===uid)await reconcile(view.state.baseline,view.state.canWrite)
    })}catch(cause){error=cause instanceof Error?cause.message:'No se pudo preparar la cola local.'}
  }
  const changed=()=>void tick()
  const timer=window.setInterval(changed,30000)
  window.addEventListener('catalog-updated',changed)
  stop=()=>{clearInterval(timer);window.removeEventListener('catalog-updated',changed)};void tick()
}
export async function startCatalog(uid:string,role:FirebaseRole){
  if(identity===`${uid}:${role}`&&wake){wake();return}
  stopCatalog()
  const epoch=generation
  const client=firebaseConnection(),view=await localView()
  if(generation!==epoch)return
  if(!client?.catalogEnabled||!view.state)return
  if(view.state.workspaceId!==client.workspaceId||view.state.ownerUid!==uid){error='Este dispositivo está vinculado con otra cuenta o espacio. No se enviaron cambios.';return}
  const transport=client.catalog(),canWrite=role!=='seller'
  identity=`${uid}:${role}`
  let active=true,running=false,again=false,failures=0,retryAt=0
  let unsubscribe:(()=>void)|undefined,listenerFailed=false,listenerFailures=0,listenerRetryAt=0
  const listen=()=>{
    unsubscribe?.();listenerFailed=false
    unsubscribe=transport.watch(value=>{if(!active||generation!==epoch)return;remote=value;listenerFailures=0;void tick()},cause=>{
      if(!active||generation!==epoch)return
      error=cause.message;remote=undefined;listenerFailed=true
      listenerRetryAt=Date.now()+Math.min(60000,2000*2**Math.min(++listenerFailures,5))
    })
  }
  const tick=async()=>{
    if(!active||generation!==epoch||Date.now()<retryAt)return
    if(running){again=true;return}
    if(listenerFailed&&navigator.onLine&&Date.now()>=listenerRetryAt)listen()
    running=true;busy=true
    try{
      await navigator.locks.request('matu-catalog-sync',async()=>{
        if(!active||generation!==epoch)return
        // A missing network snapshot cannot be interpreted as an empty cloud catalog.
        const view=await localView()
        if(!view.state||view.state.ownerUid!==uid)return
        await reconcile(remote??view.state.baseline,canWrite)
        if(!navigator.onLine||!remote)return
        if(canWrite)await flush(transport)
        error='';failures=0;retryAt=0
      })
    }catch(cause){error=cause instanceof Error?cause.message:'No se pudo sincronizar.';failures++;retryAt=Date.now()+Math.min(60000,2000*2**Math.min(failures,5))
    }finally{running=false;if(generation===epoch)busy=false;if(again&&active){again=false;queueMicrotask(()=>void tick())}}
  }
  listen()
  const timer=window.setInterval(()=>void tick(),5000)
  const online=()=>{retryAt=0;void tick()}
  wake=online
  // Local commit notifications do not originate from cloud application, avoiding echo loops.
  const changed=()=>void tick()
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('clown-ufo-catalog'):undefined
  if(channel)channel.onmessage=changed
  window.addEventListener('catalog-updated',changed)
  window.addEventListener('online',online)
  stop=()=>{active=false;unsubscribe?.();channel?.close();clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('catalog-updated',changed)}
  void tick()
}
