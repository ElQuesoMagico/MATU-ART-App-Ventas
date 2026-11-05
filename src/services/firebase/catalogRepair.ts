import { normalizedName } from '../catalogValidation.ts'
import { applyLocal, localView } from './catalogLocal.ts'
import type { LocalView } from './catalogLocal.ts'
import { keyOf, references, stable } from './catalogModel.ts'
import type { Payload, RemoteRecord } from './catalogModel.ts'

export function classificationRepairs(local: LocalView, remote: Record<string, RemoteRecord>) {
  return Object.entries(local.records).flatMap(([key, p]) => {
    if (p.entity === 'products' || remote[key]) return []
    return Object.entries(remote).filter(([,r]) => r.payload.entity === p.entity && normalizedName(r.payload.name) === normalizedName(p.name)).map(([target,r]) => ({
      key, target, name:p.name, remote:r,
      products:Object.values(local.records).filter(product => references(product).includes(key)),
    }))
  })
}

/** Caller verifies membership online immediately before taking the local lock. */
export async function adoptCatalogAccount(expected:LocalView, workspaceId:string, uid:string, role:string, name?:string) {
  if(role!=='administrator')throw new Error('Solo administración puede cambiar la cuenta vinculada.')
  if(!expected.state || expected.state.workspaceId!==workspaceId)throw new Error('No se puede cambiar el espacio de trabajo.')
  const state=structuredClone(expected.state)
  state.ownerUid=uid;state.canWrite=true
  await applyLocal(expected,state,[],name)
}

export async function repairClassification(expected:LocalView, remote:Record<string,RemoteRecord>, key:string, target:string, uid:string, workspaceId:string, role:string, name?:string) {
  if(role!=='administrator'||expected.state?.ownerUid!==uid||expected.state.workspaceId!==workspaceId)throw new Error('Verifica administración y vinculación antes de reparar.')
  if(Object.keys(expected.invalid).length)throw new Error('Corrige los productos inválidos antes de reasignar clasificaciones.')
  const candidate=classificationRepairs(expected,remote).find(r=>r.key===key&&r.target===target)
  if(!candidate)throw new Error('La coincidencia cambió. Vuelve a revisar.')
  const source=expected.records[key],destination=candidate.remote.payload
  if(source.entity==='products'||destination.entity==='products')throw new Error('No se fusionan productos.')
  if(expected.state.pending[target] || (expected.records[target] && stable(expected.records[target])!==stable(destination)))throw new Error('La clasificación destino tiene cambios locales. Resuélvelos antes de reparar.')
  const state=structuredClone(expected.state)
  const incoming:Payload[]=[]
  // Preserve the old UUID for historical references; free its unique name explicitly.
  incoming.push({...source,name:`${source.name.slice(0,65)} [local ${source.id}]`,isActive:false})
  incoming.push(destination)
  delete state.pending[key];delete state.conflicts[key];delete state.conflicts[target]
  state.excluded=[...new Set([...state.excluded.filter(k=>k!==target),key])]
  state.baseline[target]=candidate.remote
  for(const product of candidate.products) {
    if(product.entity!=='products')continue
    const pk=keyOf(product),cloud=remote[pk],baseline=state.baseline[pk]
    if(cloud&&(!baseline||cloud.revision!==baseline.revision||state.pending[pk]?.id===cloud.operationId))throw new Error(`Revisa primero la versión remota de ${product.name}.`)
    if(state.conflicts[pk]&&!state.conflicts[pk].startsWith('Faltan clasificaciones locales:'))throw new Error(`Resuelve primero el conflicto de ${product.name}.`)
    const p={...product,
      categoryId:source.entity==='categories'&&product.categoryId===source.id?destination.id:product.categoryId,
      familyIds:source.entity==='families'?[...new Set(product.familyIds.map(id=>id===source.id?destination.id:id))]:product.familyIds,
      ipIds:source.entity==='ips'?[...new Set(product.ipIds.map(id=>id===source.id?destination.id:id))]:product.ipIds}
    incoming.push(p)
    if(!state.excluded.includes(pk))state.pending[pk]={id:crypto.randomUUID(),payload:p,expectedRevision:baseline?.revision??0}
    delete state.conflicts[pk]
  }
  const available=new Set([...Object.keys(expected.records),target])
  for(const [pk,message] of Object.entries(state.conflicts))if(message.startsWith('Faltan clasificaciones locales:')&&remote[pk]&&references(remote[pk].payload).every(ref=>available.has(ref)))delete state.conflicts[pk]
  // applyLocal compares the entire preview token and commits all changes atomically.
  await applyLocal(expected,state,incoming,name)
}

export async function assertRepairPreview(expected:LocalView, snapshot:Record<string,RemoteRecord>, current:Record<string,RemoteRecord>, name?:string) {
  if(stable(snapshot)!==stable(current)||(await localView(name)).token!==expected.token)throw new Error('El catálogo cambió. Actualiza la vista previa antes de confirmar.')
}
