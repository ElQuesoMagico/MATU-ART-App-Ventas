import { z } from 'zod'
import type { CatalogProduct, CatalogClassification } from '../../types/catalog.ts'
import { normalizedName } from '../catalogValidation.ts'
export const kinds = ['categories', 'families', 'ips', 'products'] as const
export type Kind = typeof kinds[number]
const id = z.uuid(), ids = z.array(id).max(3).refine(a => new Set(a).size === a.length)
const common = { id, name: z.string().trim().min(1).max(120).refine(name=>!name.includes('/'),'El nombre no admite / en el catálogo cloud'), description: z.string().max(2000), createdAt: z.iso.datetime({ offset: true }) }
export const payloadSchema = z.discriminatedUnion('entity', [
  z.object({ ...common, entity: z.literal('products'), categoryId: id, familyIds: ids, ipIds: ids, price: z.number().int().min(0).max(1_000_000_000), isArchived: z.boolean(), isFavorite: z.boolean(), kind: z.enum(['product','pack']) }).strict(),
  ...(['categories','families','ips'] as const).map(entity => z.object({ ...common, entity: z.literal(entity), isActive: z.boolean(), order: z.number().int().min(0).max(1_000_000) }).strict()),
])
export type Payload = z.infer<typeof payloadSchema>
export interface RemoteRecord { payload: Payload; revision: number; operationId: string }
export interface Pending { id: string; payload: Payload; expectedRevision: number }
export interface SyncState {
  key: 'catalog'; workspaceId: string; deviceId: string; ownerUid: string; canWrite: boolean;
  baseline: Record<string, RemoteRecord>; pending: Record<string, Pending>;
  excluded: string[]; conflicts: Record<string, string>; lastConfirmed?: string;
}
const remoteSchema = z.object({ payload: payloadSchema, revision: z.number().int().positive(), operationId: id }).strict()
export const syncStateSchema = z.object({ key: z.literal('catalog'), workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/), deviceId: id, ownerUid: z.string().min(1), canWrite:z.boolean(), baseline: z.record(z.string(), remoteSchema), pending: z.record(z.string(), z.object({ id, payload: payloadSchema, expectedRevision: z.number().int().nonnegative() }).strict()), excluded: z.array(z.string()), conflicts: z.record(z.string(), z.string()), lastConfirmed: z.iso.datetime({offset:true}).optional() }).strict()
export const keyOf = (p: Payload) => `${p.entity}/${p.id}`
export const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export function project(entity: Kind, row: CatalogProduct | CatalogClassification): Payload {
  const common = { entity, id: row.id, name: row.name, description: row.description ?? '', createdAt: row.createdAt }
  return payloadSchema.parse(entity === 'products' && 'price' in row
    ? { ...common, categoryId: row.categoryId, familyIds: row.familyIds ?? [], ipIds: row.ipIds ?? [], price: row.price, isArchived: row.isArchived, isFavorite: row.isFavorite, kind: row.kind ?? 'product' }
    : { ...common, isActive: 'isActive' in row && row.isActive, order: 'order' in row ? row.order : 0 })
}
export function mergeProduct(payload: Extract<Payload, { entity:'products' }>, previous?: CatalogProduct): CatalogProduct {
  const { entity: _entity, ...fields } = payload
  if (previous && (previous.kind ?? 'product') !== payload.kind) throw new Error('No se puede cambiar el tipo de un producto existente.')
  return { stock: 0, lowStockThreshold: 0, averageCostIsProvisional: true,
    ...previous, ...fields, stockCountPending: previous ? previous.stockCountPending : true, categoryIds: [payload.categoryId], classificationPending: false,
    activeName: payload.isArchived ? undefined : normalizedName(payload.name),
    updatedAt: new Date().toISOString(), revision: (previous?.revision ?? 0) + 1 }
}
export function references(p: Payload): string[] {
  return p.entity === 'products' ? [`categories/${p.categoryId}`, ...p.familyIds.map(id=>`families/${id}`), ...p.ipIds.map(id=>`ips/${id}`)] : []
}
