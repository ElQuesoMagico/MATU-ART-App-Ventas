import type { IDBPTransaction } from 'idb'
import type { CatalogSchema } from './catalogDatabase.ts'
import type { StoreName } from './data/snapshot.ts'
import { openCatalogDatabase } from './catalogDatabase.ts'
import { assertNoPendingOperations, assertStoreSet, canonical, stores, type DataSnapshot } from './data/snapshot.ts'
import { CatalogError, validId } from './catalogValidation.ts'

export const entityKinds = ['products', 'categories', 'families', 'ips', 'promotions'] as const
export type EntityKind = typeof entityKinds[number]
export const entityLabels: Record<EntityKind, string> = { products: 'Producto', categories: 'Categoría', families: 'Familia', ips: 'IP', promotions: 'Promoción' }
export interface DeletionReview { id: string; kind: EntityKind; name: string; token: string; blockers: string[]; allowed: boolean }
const relationLabels: Record<StoreName,string> = { products:'Productos',categories:'Categorías',families:'Familias',ips:'IPs',movements:'Movimientos de inventario',costChanges:'Cambios de costo',sales:'Ventas históricas',payments:'Pagos',metadata:'Metadatos',events:'Eventos históricos',managedEvents:'Eventos',promotions:'Promociones y combos',expenses:'Gastos',expenseCategories:'Categorías de gastos',expenseChanges:'Auditoría de gastos',importRecords:'Procedencia de importaciones' }

// Conservative UUID inspection includes nested historical snapshots and future fields.
// Root IDs are identities, not references (legacy categories/families share an ID).
function references(value: unknown, id: string): boolean {
  if (value === id) return true
  if (Array.isArray(value)) return value.some(item => references(item, id))
  if (value && typeof value === 'object' && !(value instanceof Blob)) return Object.values(value).some(item => references(item, id))
  return false
}
export function reviewDeletion(data: DataSnapshot, kind: EntityKind, id: string): DeletionReview {
  if (!entityKinds.includes(kind)) throw new CatalogError('Tipo de entidad inválido.')
  validId(id)
  const item = data[kind].find(row => row.id === id)
  if (!item) throw new CatalogError('El registro ya no existe.')
  const blockers: string[] = []
  try { assertNoPendingOperations(data) } catch { blockers.push('Estado de sincronización o metadatos no reconocidos: solo se permite archivar.') }
  for (const key of stores) {
    const count = data[key].filter(row => {
      if (key === kind && 'id' in row && row.id === id) return false
      const fields = Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'id'))
      return references(fields, id)
    }).length
    if (count) blockers.push(`${relationLabels[key]} (${key}): ${count} registro(s) relacionado(s).`)
  }
  if (kind === 'products') {
    const product = data.products.find(row => row.id === id)!
    if (product.stock !== 0) blockers.push('El producto conserva existencias.')
    if (product.averageCost !== undefined || product.lastKnownCost !== undefined || product.estimatedUnitCost !== undefined) blockers.push('El producto conserva antecedentes de costos.')
    if (product.eventPrices?.length) blockers.push('El producto tiene precios asociados a eventos.')
  }
  // Fail closed on synchronization metadata added by a future integration.
  if (Object.keys(item).some(key => /sync|cloud|remote|tombstone/i.test(key))) blockers.push('El registro tiene información cloud. Archívalo hasta disponer de un protocolo de borrado remoto.')
  return { id, kind, name: item.name, token: canonical(item), blockers, allowed: blockers.length === 0 }
}
export class EntityAdministration {
  private readonly databaseName?: string
  constructor(databaseName?: string) { this.databaseName = databaseName }
  private async transaction<T>(operation: (data: DataSnapshot, tx: IDBPTransaction<CatalogSchema, StoreName[], 'readwrite'>) => Promise<T>) {
    const db = await openCatalogDatabase(this.databaseName)
    try { assertStoreSet(db.objectStoreNames) } catch (error) { db.close(); throw error }
    const tx = db.transaction([...stores], 'readwrite')
    void tx.done.catch(() => {})
    try {
      const entries = await Promise.all(stores.map(async key => [key, await tx.objectStore(key).getAll()]))
      const result = await operation(Object.fromEntries(entries) as DataSnapshot, tx)
      await tx.done
      return result
    } catch (error) { try { tx.abort() } catch { /* Already aborted. */ } await tx.done.catch(() => {}); throw error }
    finally { db.close() }
  }
  review(kind: EntityKind, id: string) { return this.transaction(async data => reviewDeletion(data, kind, id)) }
  remove(review: DeletionReview, confirmation: string) {
    return this.transaction(async (data, tx) => {
      const current = reviewDeletion(data, review.kind, review.id)
      if (current.token !== review.token) throw new CatalogError('El registro cambió. Cierra y revisa de nuevo antes de eliminar.')
      if (!current.allowed) throw new CatalogError(`No se puede eliminar. ${current.blockers.join(' ')}`)
      if (confirmation !== current.name) throw new CatalogError('Escribe el nombre exacto para confirmar la eliminación permanente.')
      await tx.objectStore(review.kind).delete(review.id)
    })
  }
  previewCategory(sourceId: string, targetId: string) {
    return this.transaction(async data => this.categoryPlan(data, sourceId, targetId))
  }
  private categoryPlan(data: DataSnapshot, sourceId: string, targetId: string) {
    validId(sourceId); validId(targetId); assertNoPendingOperations(data)
    if (sourceId === targetId || !data.categories.some(c => c.id === sourceId) || !data.categories.some(c => c.id === targetId && c.isActive)) throw new CatalogError('Selecciona otra categoría activa.')
    const products = data.products.filter(p => p.categoryId === sourceId || p.categoryIds.includes(sourceId))
    if (products.some(product => Object.keys(product).some(key => /sync|cloud|remote|tombstone/i.test(key)))) throw new CatalogError('Hay productos con información cloud; no se permite una reasignación masiva sin protocolo de sincronización.')
    return { sourceId, targetId, products, token: canonical({ categories: data.categories, products }) }
  }
  reassignCategory(sourceId: string, targetId: string, expectedToken: string) {
    return this.transaction(async (data, tx) => {
      const plan = this.categoryPlan(data, sourceId, targetId)
      if (plan.token !== expectedToken) throw new CatalogError('Cambió el catálogo. Revisa una nueva vista previa.')
      for (const product of plan.products) {
        await tx.objectStore('products').put({ ...product, categoryId: product.categoryId === sourceId ? targetId : product.categoryId, categoryIds: [...new Set(product.categoryIds.map(id => id === sourceId ? targetId : id))], classificationPending: product.categoryId === sourceId ? false : product.classificationPending, revision: product.revision + 1, updatedAt: new Date(Math.max(Date.now(), Date.parse(product.updatedAt) + 1)).toISOString() })
      }
      return plan.products.length
    })
  }
}
export const entityAdministration = new EntityAdministration()
