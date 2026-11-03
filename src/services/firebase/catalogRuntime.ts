import { firebaseConnection } from './client'
import { flush, localView, reconcile } from './catalogLocal'
import type { RemoteRecord } from './catalogModel'
import type { FirebaseRole } from './access'
let stop: (()=>void)|undefined, generation=0
let remote:Record<string,RemoteRecord>|undefined
let error='',busy=false
export const catalogStatus=()=>({error,busy,remote})
export function stopCatalog(){generation++;stop?.();stop=undefined;remote=undefined;busy=false;error=''}
export function startOfflineCatalog(uid:string){
  stopCatalog();const epoch=generation
  const tick=async()=>{
    try{await navigator.locks.request('matu-catalog-sync',async()=>{
      if(epoch!==generation)return
      const view=await localView();if(view.state?.ownerUid===uid)await reconcile(view.state.baseline,view.state.canWrite)
    })}catch(cause){error=cause instanceof Error?cause.message:'No se pudo preparar la cola local.'}
  }
  const timer=window.setInterval(()=>void tick(),5000);stop=()=>clearInterval(timer);void tick()
}
export async function startCatalog(uid:string,role:FirebaseRole){
  stopCatalog()
  const epoch=generation
  const client=firebaseConnection(),view=await localView()
  if(generation!==epoch)return
  if(!client?.catalogEnabled||!view.state)return
  if(view.state.workspaceId!==client.workspaceId||view.state.ownerUid!==uid){error='Este dispositivo está vinculado con otra cuenta o espacio. No se enviaron cambios.';return}
  const transport=client.catalog(),canWrite=role!=='seller'
  let active=true,running=false,failures=0,retryAt=0
  const tick=async()=>{
    if(!active||running||generation!==epoch||Date.now()<retryAt)return
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
    }finally{running=false;if(generation===epoch)busy=false}
  }
  const unsubscribe=transport.watch(value=>{remote=value;void tick()},cause=>{error=cause.message;remote=undefined})
  const timer=window.setInterval(()=>void tick(),5000)
  const online=()=>{retryAt=0;void tick()}
  window.addEventListener('online',online)
  stop=()=>{active=false;unsubscribe();clearInterval(timer);window.removeEventListener('online',online)}
  void tick()
}
