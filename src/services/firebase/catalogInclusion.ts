import { normalizedName } from '../catalogValidation.ts'
import { applyLocal } from './catalogLocal.ts'
import type { LocalView } from './catalogLocal.ts'
import { references, stable } from './catalogModel.ts'
import type { Payload, RemoteRecord } from './catalogModel.ts'
import type { FirebaseRole } from './access.ts'

export type InclusionChoice = 'local' | 'remote'
export interface InclusionEntry { key:string; payload:Payload; action:'upload'|'download'|'match' }
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
  if(!local.state||local.state.ownerUid!==uid||local.state.workspaceId!==workspaceId)throw new Error('La cuenta o el espacio no coincide con la vinculación. Revisa la vinculación primero.')
  const entries=inclusionPreview(local,remote,key,choice)
  if(role==='seller'&&(choice==='local'||entries.some(e=>e.action==='upload')))throw new Error('El rol Vendedor solo puede recibir la versión de la nube.')
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
