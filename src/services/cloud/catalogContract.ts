import { z } from 'zod'

export const entityKinds = ['categories','families','ips','products'] as const
export type CatalogEntityKind = typeof entityKinds[number]
const id=z.uuid(), text=z.string().trim().min(1).max(200), date=z.iso.datetime({offset:true})
const ids=z.array(id).max(100).refine(v=>new Set(v).size===v.length,'IDs duplicados')
const common={id,name:text,description:z.string().max(5000).optional(),createdAt:date,updatedAt:date}
export const classificationPayload=z.object({...common,isActive:z.boolean(),order:z.number().int().safe().nonnegative()}).strict()
// Deliberately excludes counts, costs, images, event prices and all transactional data.
export const productPayload=z.object({...common,categoryId:id, familyIds:ids,ipIds:ids,price:z.number().int().safe().nonnegative(),isArchived:z.boolean(),isFavorite:z.boolean(),kind:z.enum(['product','pack']),stockPolicy:z.literal('local-only')}).strict()
export const catalogRecord=z.discriminatedUnion('entity',[
  z.object({entity:z.literal('categories'),payload:classificationPayload}).strict(),
  z.object({entity:z.literal('families'),payload:classificationPayload}).strict(),
  z.object({entity:z.literal('ips'),payload:classificationPayload}).strict(),
  z.object({entity:z.literal('products'),payload:productPayload}).strict(),
])
export type CatalogRecord=z.infer<typeof catalogRecord>
export const cloudRecord=z.object({record:catalogRecord,revision:z.number().int().positive().safe()}).strict()
export type CloudRecord=z.infer<typeof cloudRecord>
export const catalogSnapshot=z.object({workspaceId:id,records:z.array(cloudRecord).max(2000)}).strict()
export type CatalogSnapshot=z.infer<typeof catalogSnapshot>
export const catalogOperation=z.object({version:z.literal(1),operationId:id,deviceId:id,changes:z.array(z.object({record:catalogRecord,expectedRevision:z.number().int().positive().safe().nullable()}).strict()).min(1).max(200)}).strict()
export type CatalogOperation=z.infer<typeof catalogOperation>
export const catalogAck=z.object({operationId:id,workspaceId:id,confirmedAt:date,records:z.array(cloudRecord).min(1).max(200)}).strict()
export type CatalogAck=z.infer<typeof catalogAck>
export const schemaReport=z.object({ready:z.boolean(),missing:z.array(z.string()),invalid:z.array(z.string())}).strict()
export function recordKey(record:CatalogRecord){return `${record.entity}:${record.payload.id}`}
export function stable(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value)
}
/** Deterministic CAS, no last-write-wins. Mirrors the server-side Apps Script guard. */
export function applyCatalogChanges(existing:CloudRecord[],operation:CatalogOperation):CloudRecord[] {
  const parsed=catalogOperation.parse(operation),records=new Map(existing.map(r=>[recordKey(r.record),r])),seen=new Set<string>()
  if(records.size!==existing.length)throw new Error('DUPLICATE_RECORD')
  for(const change of parsed.changes){const key=recordKey(change.record);if(seen.has(key))throw new Error('DUPLICATE_RECORD');seen.add(key);const current=records.get(key)
    if((current?.revision??null)!==change.expectedRevision)throw new Error('CONFLICT')
    records.set(key,{record:change.record,revision:(current?.revision??0)+1})
  }
  const names=new Set<string>()
  for(const {record} of records.values()){
    const p=record.payload,active=record.entity==='products'?!record.payload.isArchived:record.payload.isActive
    const name=`${record.entity}:${p.name.trim().toLocaleLowerCase('es')}`
    if(active&&names.has(name))throw new Error('NAME_CONFLICT');if(active)names.add(name)
    if(record.entity==='products')for(const [kind,refs] of [['categories',[record.payload.categoryId]],['families',record.payload.familyIds],['ips',record.payload.ipIds]] as const)for(const ref of refs)if(!records.has(`${kind}:${ref}`))throw new Error('MISSING_REFERENCE')
  }
  return [...records.values()]
}
