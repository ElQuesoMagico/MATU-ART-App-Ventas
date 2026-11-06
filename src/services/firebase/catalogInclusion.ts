import { normalizedName } from '../catalogValidation.ts'
import { applyLocal } from './catalogLocal.ts'
import type { LocalView } from './catalogLocal.ts'
import { references, stable } from './catalogModel.ts'
import type { Payload, RemoteRecord } from './catalogModel.ts'
import type { FirebaseRole } from './access.ts'

export type InclusionChoice = 'local' | 'remote'
export interface InclusionEntry { key:string; payload:Payload; action:'upload'|'download'|'match' }
export interface InclusionSelection { key:string; choice:InclusionChoice }
/** Resolve explicitly selected versions first; only identical dependencies may join implicitly. */
export function bulkInclusionPreview(local:LocalView,remote:Record<string,RemoteRecord>,selections:InclusionSelection[]):InclusionEntry[] {
  if(!local.state||!selections.length)throw new Error('Selecciona al menos un registro.')
  if(new Set(selections.map(s=>s.key)).size!==selections.length)throw new Error('Selección duplicada.')
  const selected=new Map(selections.map(s=>[s.key,s.choice])),entries=new Map<string,InclusionEntry>()
  for(const {key} of selections)if(!local.state.excluded.includes(key))throw new Error('El registro ya no está excluido. Actualiza la comparación.')
  const add=(key:string,choice:InclusionChoice|undefined)=>{
    if(entries.has(key))return
    const here=local.records[key],cloud=remote[key]?.payload
    if(local.state!.pending[key]||local.state!.conflicts[key])throw new Error(`Resuelve primero los pendientes o conflictos de ${here?.name??cloud?.name??key}.`)
    if(!choice){
      if(here&&cloud&&stable(here)!==stable(cloud))throw new Error(`La clasificación «${here.name}» difiere de la nube. Selecciona su versión explícitamente.`)
      choice=cloud?'remote':'local'
    }
    const payload=choice==='local'?here:cloud
    if(!payload)throw new Error(`Falta una versión o clasificación necesaria: ${key}.`)
    const action=choice==='local'?(cloud&&stable(payload)===stable(cloud)?'match':'upload'):'download'
    entries.set(key,{key,payload,action})
    for(const ref of references(payload)){
      if(selected.has(ref)){add(ref,selected.get(ref));continue}
      if(choice==='remote'&&!remote[ref])throw new Error(`Falta una clasificación necesaria: ${ref}.`)
      add(ref,undefined)
    }
  }
  for(const s of selections)add(s.key,s.choice)
  // Validate both final catalogs, including dependencies, before making any local mutation.
  const futureLocal={...local.records},futureRemote=Object.fromEntries(Object.entries(remote).map(([key,r])=>[key,r.payload]))
  for(const e of entries.values()){futureLocal[e.key]=e.payload;if(e.action==='upload')futureRemote[e.key]=e.payload}
  for(const e of entries.values())for(const records of [futureLocal,futureRemote]){
    if(Object.entries(records).some(([key,p])=>key!==e.key&&p.entity===e.payload.entity&&normalizedName(p.name)===normalizedName(e.payload.name)))throw new Error(`«${e.payload.name}» coincide con otro UUID. Repara la coincidencia antes de incluirlo.`)
  }
  return [...entries.values()].filter(e=>selected.has(e.key)||local.state!.excluded.includes(e.key)||!local.state!.baseline[e.key])
}

export async function includeCatalogRecords(local:LocalView,remote:Record<string,RemoteRecord>,selections:InclusionSelection[],uid:string,workspaceId:string,role:FirebaseRole,name?:string){
  if(role==='seller'&&selections.some(s=>s.choice==='local'))throw new Error('El rol Vendedor solo puede recibir la versión de la nube.')
  const entries=bulkInclusionPreview(local,remote,selections)
  await applyInclusion(local,remote,entries,uid,workspaceId,role,name)
}
export function inclusionPreview(local:LocalView, remote:Record<string,RemoteRecord>, key:string, choice:InclusionChoice):InclusionEntry[] {
  if(!local.state?.excluded.includes(key))throw new Error('El registro ya no está excluido. Actualiza la comparación.')
  const payload=choice==='local'?local.records[key]:remote[key]?.payload
  if(!payload)throw new Error('La versión seleccionada no existe o es inválida.')
  const entries:InclusionEntry[]=[]
  const add=(k:string,p:Payload,action:InclusionEntry['action'])=>{
    if(local.state!.pending[k]||local.state!.conflicts[k])throw new Error(`Resuelve primero los pendientes o conflictos de ${p.name}.`)
    const collision=Object.entries(action==='upload'?remote:local.records).some(([other,value])=>{
      const candidate='payload' in value?value.payload:value
      return other!==k&&candidate.entity===p.entity&&normalizedName(candidate.name)===normalizedName(p.name)
    })
    if(collision)throw new Error(`«${p.name}» coincide con otro UUID. Repara esa clasificación o producto antes de incluirlo.`)
    entries.push({key:k,payload:p,action})
  }
  for(const ref of references(payload)) {
    const here=local.records[ref],cloud=remote[ref]
    if(local.state.pending[ref]||local.state.conflicts[ref])throw new Error(`Resuelve primero los pendientes o conflictos de ${here?.name??ref}.`)
    if(here&&cloud&&stable(here)!==stable(cloud.payload))throw new Error(`La clasificación «${here.name}» difiere de la nube. Resuélvela por separado antes de incluir el producto.`)
    if(here&&cloud) {
      if(local.state.excluded.includes(ref)||!local.state.baseline[ref])add(ref,here,'match')
    } else if(cloud) add(ref,cloud.payload,'download')
    else if(here&&choice==='local')add(ref,here,'upload')
    else throw new Error(`Falta una clasificación necesaria: ${ref}. No se modificaron datos.`)
  }
  add(key,payload,choice==='remote'?'download':remote[key]&&stable(payload)===stable(remote[key].payload)?'match':'upload')
  return entries
}

/** Called under the catalog lock after fresh online membership and preview verification. */
export async function includeCatalogRecord(local:LocalView, remote:Record<string,RemoteRecord>, key:string, choice:InclusionChoice, uid:string, workspaceId:string, role:FirebaseRole, name?:string) {
  if(role==='seller'&&choice==='local')throw new Error('El rol Vendedor solo puede recibir la versión de la nube.')
  const entries=inclusionPreview(local,remote,key,choice)
  await applyInclusion(local,remote,entries,uid,workspaceId,role,name)
}
async function applyInclusion(local:LocalView,remote:Record<string,RemoteRecord>,entries:InclusionEntry[],uid:string,workspaceId:string,role:FirebaseRole,name?:string){
  if(!local.state||local.state.ownerUid!==uid||local.state.workspaceId!==workspaceId)throw new Error('La cuenta o el espacio no coincide con la vinculación. Revisa la vinculación primero.')
  if(role==='seller'&&entries.some(e=>e.action==='upload'))throw new Error('El rol Vendedor solo puede recibir la versión de la nube.')
  const state=structuredClone(local.state),incoming:Payload[]=[]
  for(const entry of entries) {
    state.excluded=state.excluded.filter(k=>k!==entry.key)
    if(remote[entry.key])state.baseline[entry.key]=remote[entry.key]
    else delete state.baseline[entry.key]
    if(entry.action==='upload')state.pending[entry.key]={id:crypto.randomUUID(),payload:entry.payload,expectedRevision:remote[entry.key]?.revision??0}
    if(entry.action==='download')incoming.push(entry.payload)
  }
  if(entries.some(e=>e.action!=='upload'))state.lastConfirmed=new Date().toISOString()
  await applyLocal(local,state,incoming,name)
}
