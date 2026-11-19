import type { DataSnapshot } from '../data/snapshot.ts'
import { readData } from '../data/snapshot.ts'
import { entityAdministration, type EntityKind, type DeletionReview } from '../entityAdministration.ts'
import { localView, applyLocal } from './catalogLocal.ts'
import { stable, references, type RemoteRecord, type Kind } from './catalogModel.ts'

export function containsReference(value:unknown,id:string):boolean {
  if(value===id)return true
  if(Array.isArray(value))return value.some(v=>containsReference(v,id))
  return !!value&&typeof value==='object'&&Object.entries(value).some(([k,v])=>k!=='id'&&containsReference(v,id))
}
export function deletionBlockers(data:DataSnapshot,kind:Kind,id:string,remote:Record<string,RemoteRecord>,configuration:unknown):string[]{
  const key=`${kind}/${id}`, blockers:string[]=[]
  const state=data.catalogSync[0]
  if(state?.pending[key]||state?.conflicts[key])blockers.push('Este registro tiene cambios pendientes o conflictos. Resuélvelos antes de eliminar.')
  if(Object.keys(state?.pending??{}).length)blockers.push('Espera a que termine la sincronización del catálogo antes de eliminar.')
  if(data.inventorySync.some(s=>s.operations.some(o=>['pending','conflict'].includes(o.state)&&o.intent.productId===id)))blockers.push('Hay operaciones de inventario pendientes para este producto.')
  if(data.commercialSync.some(s=>s.configurationPending||s.configurationConflict||s.operations.some(o=>o.state!=='confirmed'&&containsReference(o.intent,id))))blockers.push('Hay operaciones comerciales pendientes. Resuélvelas antes de eliminar.')
  const products=Object.values(remote).filter(r=>!r.deleted&&references(r.payload).includes(key))
  const localProducts=data.products.filter(p=>!state?.baseline[`products/${p.id}`]?.deleted&&(kind==='categories'?p.categoryId===id:kind==='families'?p.familyIds?.includes(id):kind==='ips'?p.ipIds?.includes(id):false))
  const names=[...new Set([...products.map(r=>r.payload.name),...localProducts.map(p=>p.name)])]
  if(names.length)blockers.push(`${names.length} productos asociados: ${names.join(', ')}. Reasígnalos o desvincúlalos antes de eliminar.`)
  if(containsReference(configuration,id)||data.promotions.some(p=>containsReference(p,id))||data.products.some(p=>p.id!==id&&containsReference(p.packContents,id)))blockers.push('Hay promociones, packs o precios por evento asociados. Revisa esas relaciones primero.')
  if(kind==='products'&&data.products.some(p=>p.id===id&&p.stock!==0&&!p.stockCountPending))blockers.push('El producto conserva existencias locales. Confirma el inventario antes de eliminar.')
  return blockers
}
export interface SharedDeletionReview extends DeletionReview {
  cloud?:{revision:number;epoch:number;configurationToken:string;operationId:string;localToken:string}
}
export async function reviewSharedDeletion(kind:EntityKind,id:string):Promise<SharedDeletionReview>{
  const local=await localView()
  if(!local.state)return entityAdministration.review(kind,id)
  if(kind==='promotions')return {...await entityAdministration.review(kind,id),allowed:false,blockers:['La promoción pertenece a la configuración comercial compartida. Su eliminación requiere un protocolo propio; puedes desactivarla o archivarla.']}
  if(!navigator.onLine)throw new Error('Conéctate a Internet para revisar y confirmar una eliminación compartida.')
  const {firebaseConnection}=await import('./client.ts')
  const client=firebaseConnection();if(!client||client.identity()!==local.state.ownerUid||client.workspaceId!==local.state.workspaceId)throw new Error('Inicia sesión con la cuenta vinculada.')
  const access=await client.verify();if(access.role==='seller')throw new Error('Tu rol no permite eliminar registros.')
  const snapshot=await client.catalog().deletionSnapshot(),key=`${kind}/${id}`,record=snapshot.records[key]
  if(!record||record.deleted)throw new Error('El registro no está compartido o ya fue eliminado. Revisa su vinculación.')
  const data=await readData(),blockers=deletionBlockers(data,kind,id,snapshot.records,snapshot.configuration)
  if(stable(local.records[key])!==stable(record.payload))blockers.push('La versión local difiere de la compartida. Sincroniza y vuelve a revisar.')
  return {kind,id,name:record.payload.name,token:stable(record),allowed:!blockers.length,blockers,cloud:{revision:record.revision,epoch:snapshot.epoch,configurationToken:stable(snapshot.configuration),operationId:crypto.randomUUID(),localToken:stable(data)}}
}
export async function removeSharedEntity(review:SharedDeletionReview,confirmation:string){
  if(!review.cloud)return entityAdministration.remove(review,confirmation)
  if(!review.allowed||confirmation!==review.name)throw new Error('Confirma el nombre del registro antes de eliminar.')
  if(!navigator.onLine)throw new Error('No se eliminó nada. Vuelve a intentarlo con conexión.')
  await navigator.locks.request('matu-catalog-sync',async()=>{
    const {firebaseConnection}=await import('./client.ts')
    const client=firebaseConnection(),local=await localView()
    if(!client||!local.state||client.identity()!==local.state.ownerUid||client.workspaceId!==local.state.workspaceId)throw new Error('La sesión cambió. Revisa de nuevo.')
    if(stable(await readData())!==review.cloud!.localToken)throw new Error('Hay cambios locales. Cierra y vuelve a revisar la eliminación.')
    const key=`${review.kind}/${review.id}`
    const ack=await client.catalog().remove(key,review.cloud!.revision,review.cloud!.epoch,review.cloud!.operationId,local.state.deviceId,review.cloud!.configurationToken)
    // Remote confirmation is authoritative; a local race is recovered by the listener.
    const current=await localView();if(!current.state)throw new Error('Eliminación confirmada en la nube. Recarga para actualizar el dispositivo.')
    const state=structuredClone(current.state);state.baseline[key]=ack;delete state.pending[key];delete state.conflicts[key]
    await applyLocal(current,state,[])
  })
}
