import { firebaseConnection } from '../client'
import type { FirebaseRole } from '../access'
import { collectConfiguration, commercialView, commercialError, receiveConfiguration, receiveSales } from './commercialLocal'
import { stable } from '../catalogModel'
import { notifyInventory } from './inventoryRuntime'
let dispose: (()=>void)|undefined, wake: (()=>void)|undefined, identity='', lastError=''
export const commercialStatus=()=>({error:lastError,automatic:!!identity})
export const wakeCommercial=()=>wake?.()
export function stopCommercial(){dispose?.();dispose=undefined;wake=undefined;identity='';lastError=''}
export function startCommercial(uid:string,role:FirebaseRole){
  const client=firebaseConnection();if(!client?.commercialEnabled)return
  if(identity===`${uid}:${role}`){wake?.();return}
  stopCommercial();identity=`${uid}:${role}`
  let active=true,leader=false,running=false,retryAt=0,failures=0,release:(()=>void)|undefined
  let configListener:(()=>void)|undefined,saleListener:(()=>void)|undefined,cursorKey=''
  const remote=client.commercial()
  function fail(error:unknown){lastError=error instanceof Error?error.message:'No se pudo compartir la operación.';retryAt=Date.now()+Math.min(60000,2000*2**Math.min(++failures,5))}
  const current=()=>active&&client.identity()===uid
  const tick=async()=>{
    if(!current()||!leader||running||!navigator.onLine||Date.now()<retryAt)return
    running=true
    try{await navigator.locks.request('matu-inventory-write',async()=>{
      const state=await collectConfiguration(uid,role!=='seller')
      if(!current()||!state||state.workspaceId!==client.workspaceId)return
      if(!configListener)configListener=remote.configuration.watch(record=>{
        if(!record)return
        void navigator.locks.request('matu-inventory-write',async()=>{if(current()){await receiveConfiguration(record,uid);notifyInventory()}}).catch(error=>{configListener?.();configListener=undefined;fail(error)})
      },error=>{configListener?.();configListener=undefined;fail(error)})
      const key=stable(state.cursor??null)
      if(!saleListener||cursorKey!==key){
        saleListener?.();cursorKey=key
        saleListener=remote.sales.watchPage(state.cursor,rows=>{void navigator.locks.request('matu-inventory-write',async()=>{
          if(!current()||cursorKey!==key||stable((await commercialView()).state?.cursor??null)!==key)return
          await receiveSales(rows,uid,client.workspaceId);saleListener?.();saleListener=undefined;lastError='';failures=0;notifyInventory()
        }).then(()=>{void tick()}).catch(error=>{saleListener?.();saleListener=undefined;fail(error)})},error=>{saleListener?.();saleListener=undefined;fail(error)})
      }
      if(state.configurationPending&&!state.configurationConflict&&role!=='seller'){
        try{const record=await remote.configuration.commit(state.configurationPending);if(current()){await receiveConfiguration(record,uid);notifyInventory()}}
        catch(error){await commercialError(uid,error instanceof Error?error.message:'No se compartió la configuración.');throw error}
      }
      const op=state.operations.find(op=>op.state==='pending')
      if(op){
        const id=op.kind==='sale'?op.intent.sale.operationId:op.intent.operationId
        try{
          if(op.kind==='sale')await remote.sales.commitSale(op.intent);else await remote.sales.commitVoid(op.intent)
          const receipt=await remote.sales.confirmed(id)
          if(current()){await receiveSales([receipt],uid,client.workspaceId);notifyInventory()}
        }catch(error){await commercialError(uid,error instanceof Error?error.message:'No se compartió la venta.',id);throw error}
      }
      lastError='';failures=0;retryAt=0
    })}catch(error){fail(error)}finally{running=false}
  }
  const elect=()=>{if(!active||leader)return;void navigator.locks.request('matu-commerce-leader',{ifAvailable:true},async lock=>{if(!lock||!active)return;leader=true;await new Promise<void>(resolve=>{release=resolve;void tick()});leader=false})}
  const online=()=>{retryAt=0;elect();void tick()};wake=online
  const timer=window.setInterval(()=>{elect();void tick()},2000)
  window.addEventListener('online',online)
  dispose=()=>{active=false;configListener?.();saleListener?.();release?.();clearInterval(timer);window.removeEventListener('online',online)}
  elect()
}
