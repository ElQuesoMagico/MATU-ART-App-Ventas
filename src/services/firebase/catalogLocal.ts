import { openCatalogDatabase } from '../catalogDatabase.ts'
import { normalizedName } from '../catalogValidation.ts'
import { kinds, project, keyOf, stable, mergeProduct, references } from './catalogModel.ts'
import type { Payload, RemoteRecord, SyncState, Pending } from './catalogModel.ts'

export interface LocalView { records: Record<string,Payload>; invalid: Record<string,string>; state?: SyncState; token: string }
export async function localView(name?: string): Promise<LocalView> {
  const db=await openCatalogDatabase(name)
  try {
    const tx=db.transaction([...kinds,'catalogSync'],'readonly'), records: Record<string,Payload>={}, invalid: Record<string,string>={}
    for(const kind of kinds) for(const row of await tx.objectStore(kind).getAll()) {
      try { const p=project(kind,row); records[keyOf(p)]=p }
      catch { invalid[`${kind}/${row.id}`]=`${row.name}: requiere categoría válida y como máximo 3 familias y 3 IPs; revisa nombre/precio.` }
    }
    const state=await tx.objectStore('catalogSync').get('catalog'); await tx.done
    return { records,invalid,state,token:stable({records,invalid,state}) }
  } finally { db.close() }
}
export interface Choice { key: string; action:'upload'|'download'|'exclude' }
/** Only a genuinely empty catalog can join without reviewing pre-existing local data. */
export async function linkEmptyCatalog(remote:Record<string,RemoteRecord>,workspaceId:string,uid:string,canWrite:boolean,name?:string) {
  const local=await localView(name)
  if(local.state||Object.keys(local.records).length||Object.keys(local.invalid).length)return false
  await linkCatalog(local,remote,Object.keys(remote).map(key=>({key,action:'download'})),workspaceId,uid,canWrite,name)
  return true
}
export function initialChoices(local:LocalView,remote:Record<string,RemoteRecord>):Choice[] {
  return preview(local,remote).map(row=>({key:row.key,action:row.status==='equal'||row.status==='remote-only'?'download':'exclude'}))
}
/** Preview only: selecting dependencies never writes or links either database. */
export function includeUploadDependencies(local:LocalView,remote:Record<string,RemoteRecord>,choices:Choice[]):Choice[] {
  const required=new Set<string>()
  for(const choice of choices)if(choice.action==='upload'){
    const payload=local.records[choice.key]
    if(payload)for(const ref of references(payload))if(!remote[ref])required.add(ref)
  }
  for(const ref of required)if(!local.records[ref])throw new Error(`Falta clasificación local: ${ref}. Corrige el producto antes de vincular.`)
  return choices.map(choice=>required.has(choice.key)?{...choice,action:'upload'}:choice)
}
export function preview(local: LocalView, remote: Record<string,RemoteRecord>) {
  return [...new Set([...Object.keys(local.records),...Object.keys(remote),...Object.keys(local.invalid)])].sort().map(key=>{
    const l=local.records[key],r=remote[key]?.payload
    const sameName=Object.entries(remote).find(([k,v])=>k!==key&&l&&v.payload.entity===l.entity&&normalizedName(v.payload.name)===normalizedName(l.name))
    return {key,name:l?.name??r?.name??local.invalid[key],status:local.invalid[key]?'invalid':sameName?'name-conflict':l&&r?(stable(l)===stable(r)?'equal':'conflict'):l?'local-only':'remote-only'}
  })
}
export async function applyLocal(expected: LocalView, state: SyncState, incoming: Payload[], name?: string, unlink = false) {
  const db=await openCatalogDatabase(name)
  const tx=db.transaction([...kinds,'catalogSync'],'readwrite'); void tx.done.catch(()=>{})
  try {
    const records: Record<string,Payload>={},invalid: Record<string,string>={}
    for(const kind of kinds) for(const row of await tx.objectStore(kind).getAll()) {
      try{const p=project(kind,row);records[keyOf(p)]=p}catch{invalid[`${kind}/${row.id}`]=`${row.name}: requiere categoría válida y como máximo 3 familias y 3 IPs; revisa nombre/precio.`}
    }
    if(stable({records,invalid,state:await tx.objectStore('catalogSync').get('catalog')})!==expected.token) throw new Error('El catálogo cambió. Vuelve a revisar la comparación.')
    for(const p of incoming.sort((a,b)=>kinds.indexOf(a.entity)-kinds.indexOf(b.entity))) {
      const store=tx.objectStore(p.entity)
      const collision=(await store.getAll()).find(row=>row.id!==p.id&&normalizedName(row.name)===normalizedName(p.name))
      if(collision) throw new Error(`Coincidencia de nombre con UUID distinto: ${p.name}. Conserva los IDs y renombra explícitamente antes de vincular.`)
      if(p.entity==='products') {
        for(const ref of references(p)) {const [kind,id]=ref.split('/'); if(!await tx.objectStore(kind as 'categories'|'families'|'ips').get(id)) throw new Error(`Falta clasificación para ${p.name}. Inclúyela en la vinculación.`)}
        const previous=await tx.objectStore('products').get(p.id)
        await tx.objectStore('products').put(mergeProduct(p,previous))
      } else {
        const {entity: _entity,...fields}=p
        await tx.objectStore(p.entity).put({...fields,normalizedName:normalizedName(p.name),...(p.entity==='categories'?{activeName:p.isActive?normalizedName(p.name):undefined}:{}),updatedAt:new Date().toISOString()})
      }
    }
    if(unlink)await tx.objectStore('catalogSync').delete('catalog')
    else await tx.objectStore('catalogSync').put(state)
    await tx.done
  } catch(error){try{tx.abort()}catch{/* settled */} await tx.done.catch(()=>{});throw error}finally{db.close()}
  if(typeof window!=='undefined')window.dispatchEvent(new Event('catalog-cloud-updated'))
}
export async function unlinkCatalog(name?:string){
  const local=await localView(name),state=local.state;if(!state)return
  if(Object.keys(state.pending).length||Object.keys(state.conflicts).length)throw new Error('Resuelve o excluye explícitamente los pendientes y conflictos antes de desvincular.')
  for(const [key,p] of Object.entries(local.records))if(!state.excluded.includes(key)&&stable(p)!==stable(state.baseline[key]?.payload))throw new Error('Hay cambios locales todavía no confirmados. Sincroniza antes de desvincular.')
  if(Object.keys(local.invalid).some(key=>!state.excluded.includes(key)))throw new Error('Hay registros pendientes de revisión.')
  await applyLocal(local,state,[],name,true)
}
export async function linkCatalog(local:LocalView,remote:Record<string,RemoteRecord>,choices:Choice[],workspaceId:string,uid:string,canWrite:boolean,name?:string) {
  if(local.state)throw new Error('El dispositivo ya está vinculado.')
  const state:SyncState={key:'catalog',workspaceId,ownerUid:uid,canWrite,deviceId:crypto.randomUUID(),baseline:{},pending:{},excluded:[],conflicts:{}}
  const incoming:Payload[]=[]
  const all=new Set([...Object.keys(local.records),...Object.keys(remote),...Object.keys(local.invalid)])
  if(choices.length!==all.size||new Set(choices.map(c=>c.key)).size!==all.size)throw new Error('Revisa todos los registros antes de confirmar.')
  for(const choice of choices){const {key,action}=choice;if(!all.has(key))throw new Error('Registro inesperado.')
    if(action==='exclude'){state.excluded.push(key);continue}
    if(remote[key])state.baseline[key]=remote[key]
    if(action==='download'){if(!remote[key])throw new Error('El registro remoto no existe.');incoming.push(remote[key].payload)}
    else {if(!canWrite)throw new Error('Solo administración puede subir catálogo.');const p=local.records[key];if(!p)throw new Error('Registro local inválido.');state.pending[key]={id:crypto.randomUUID(),payload:p,expectedRevision:remote[key]?.revision??0}}
  }
  const available=new Set([...Object.keys(remote),...Object.keys(state.pending)])
  for(const {payload} of Object.values(state.pending))for(const ref of references(payload))if(!available.has(ref))throw new Error(`Incluye las clasificaciones de ${payload.name}.`)
  if(incoming.length)state.lastConfirmed=new Date().toISOString()
  await applyLocal(local,state,incoming,name)
}
export interface CatalogTransport { commit(pending: Pending, deviceId:string):Promise<RemoteRecord> }
/** Reconcile durable local edits before contacting Firestore. No local write depends on network. */
export async function reconcile(remote:Record<string,RemoteRecord>,canWrite:boolean,name?:string) {
  const local=await localView(name); if(!local.state)return
  const state=structuredClone(local.state), incoming:Payload[]=[]
  for(const [key,message] of Object.entries(local.invalid))if(!state.excluded.includes(key))state.conflicts[key]=message
  for(const key of new Set([...Object.keys(local.records),...Object.keys(remote)])) {
    if(state.excluded.includes(key)||state.pending[key]||state.conflicts[key])continue
    const l=local.records[key],r=remote[key],b=state.baseline[key]
    const edited=l&&(!b||stable(l)!==stable(b.payload))
    if(edited){
      if(!canWrite){state.conflicts[key]='Cambios locales no autorizados para subir con este rol.';continue}
      if(r&&r.revision!==(b?.revision??0)){state.conflicts[key]='Edición concurrente. Elige explícitamente versión local o remota.';continue}
      state.pending[key]={id:crypto.randomUUID(),payload:l,expectedRevision:b?.revision??0}
    }else if(r&&(!b||r.revision!==b.revision)) {
      const collision=Object.entries(local.records).some(([other,p])=>other!==key&&p.entity===r.payload.entity&&normalizedName(p.name)===normalizedName(r.payload.name))
      if(collision){state.conflicts[key]='El nombre coincide con otro UUID local. Renombra explícitamente el registro o excluye esta descarga.';continue}
      incoming.push(r.payload);state.baseline[key]=r
    }
    else if(b&&!l)state.conflicts[key]='Registro eliminado localmente. La nube no interpreta eliminaciones: restaura o excluye explícitamente.'
  }
  // A blocked classification must not roll back unrelated downloads or their diagnostics.
  const available = new Set([...Object.keys(local.records), ...incoming.filter(p=>p.entity!=='products').map(keyOf)])
  const accepted = incoming.filter(p => {
    const missing = references(p).filter(ref=>!available.has(ref))
    if (!missing.length) return true
    const key = keyOf(p)
    state.conflicts[key] = `Faltan clasificaciones locales: ${missing.map(ref=>remote[ref]?.payload.name??ref).join(', ')}. Resuelve sus coincidencias de UUID antes de descargar este producto.`
    if(local.state!.baseline[key]) state.baseline[key]=local.state!.baseline[key]
    else delete state.baseline[key]
    return false
  })
  if(accepted.length)state.lastConfirmed=new Date().toISOString()
  if(stable(state)!==stable(local.state)||accepted.length)await applyLocal(local,state,accepted,name)
}
export async function flush(transport:CatalogTransport,name?:string){
  for(const kind of kinds){const first=await localView(name);if(!first.state)return
    for(const [key,pending] of Object.entries(first.state.pending).filter(([,p])=>p.payload.entity===kind)){
      if(first.state.conflicts[key])continue
      let ack:RemoteRecord
      try{ack=await transport.commit(pending,first.state.deviceId)}catch(error){
        if(error instanceof Error&&error.message.includes('CONFLICT')){
          const current=await localView(name)
          if(current.state?.pending[key]?.id===pending.id){const state=structuredClone(current.state);state.conflicts[key]=error.message;await applyLocal(current,state,[],name)}
        }
        throw error
      }
      // If another tab changed state, leave the operation for a safe idempotent retry.
      const current=await localView(name);if(!current.state||current.state.pending[key]?.id!==pending.id)continue
      const state=structuredClone(current.state);state.baseline[key]=ack;delete state.pending[key];state.lastConfirmed=new Date().toISOString()
      await applyLocal(current,state,[],name)
    }
  }
}
export async function resolveConflict(key:string,choice:'local'|'remote'|'exclude',remote:Record<string,RemoteRecord>,canWrite:boolean,name?:string){
  const local=await localView(name);if(!local.state)return
  const state=structuredClone(local.state),r=remote[key],p=local.records[key]
  delete state.pending[key];delete state.conflicts[key]
  const incoming:Payload[]=[]
  if(choice==='exclude')state.excluded=[...new Set([...state.excluded,key])]
  else if(choice==='remote'){if(!r)throw new Error('No hay versión remota.');state.baseline[key]=r;incoming.push(r.payload)}
  else {if(!canWrite||!p)throw new Error('No se puede subir esta versión.');if(r)state.baseline[key]=r;state.pending[key]={id:crypto.randomUUID(),payload:p,expectedRevision:r?.revision??0}}
  await applyLocal(local,state,incoming,name)
}
