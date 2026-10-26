import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { ClassificationRepository } from './classificationRepository.ts'
import { openCatalogDatabase, type CatalogSchema } from './catalogDatabase.ts'
import { CatalogError, integer, normalizedName, restockCost, validId, validateFields } from './catalogValidation.ts'
import type { CatalogProduct, CreateProductInput, InventoryMovement, MovementInput, ProductFields, ReverseMovementInput } from '../types/catalog.ts'
import { inventoryCosts, planMovementReversal } from './movementReversal.ts'

type WriteTransaction = IDBPTransaction<CatalogSchema, ['products', 'categories', 'movements', 'costChanges', 'families', 'ips', 'managedEvents'], 'readwrite'>
export class CatalogRepository {
  private database?: Promise<IDBPDatabase<CatalogSchema>>
  private readonly databaseName?: string
  constructor(databaseName?: string) { this.databaseName = databaseName }
  private db() {
    return this.database ??= openCatalogDatabase(this.databaseName).then(db => {
      db.addEventListener('versionchange', () => { this.database = undefined })
      db.addEventListener('close', () => { this.database = undefined })
      return db
    }).catch(error => { this.database = undefined; throw error })
  }
  async close() { (await this.database)?.close(); this.database = undefined }
  async snapshot() {
    const db = await this.db()
    const tx = db.transaction(['products', 'categories'], 'readonly')
    const [products, categories] = await Promise.all([tx.objectStore('products').getAll(), tx.objectStore('categories').getAll()])
    await tx.done
    return { products: products.sort((a, b) => a.name.localeCompare(b.name, 'es')), categories: categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es')) }
  }
  private async write<T>(operation: (tx: WriteTransaction) => Promise<T>): Promise<T> {
    const db = await this.db()
    const tx = db.transaction(['products', 'categories', 'movements', 'costChanges', 'families', 'ips', 'managedEvents'], 'readwrite')
    // Capturar abortos incluso cuando una validación falla antes de esperar tx.done.
    const completion = tx.done.catch(error => { throw error })
    void completion.catch(() => {})
    try { const result = await operation(tx); await completion; return result }
    catch (error) { try { tx.abort() } catch { /* Ya abortada o completada. */ } await completion.catch(() => {}); throw error }
  }
  private async classificationsExist(tx: WriteTransaction, families: string[], ips: string[], product?: CatalogProduct) {
    for (const [store, ids, existing] of [['families', families, product?.familyIds ?? product?.categoryIds ?? []], ['ips', ips, product?.ipIds ?? []]] as const) {
      for (const id of ids) {
        const item = await tx.objectStore(store).get(id)
        if (!item || (!item.isActive && !existing.includes(id))) throw new CatalogError('Una familia o IP seleccionada está archivada o ya no está disponible.')
      }
    }
  }
  private async packReferences(tx:WriteTransaction,id:string,input:ProductFields,product?:CatalogProduct) {
    for (const exception of input.eventPrices ?? product?.eventPrices ?? []) if (!await tx.objectStore('managedEvents').get(exception.eventId)) throw new CatalogError('Un evento del precio especial ya no está disponible.')
    if(product && (input.kind??product.kind??'product')!==(product.kind??'product')) throw new CatalogError('El tipo se define al crear el producto; no se convierte stock existente en packs.')
    for(const content of input.packContents??product?.packContents??[]) {
      if(content.productId===id) throw new CatalogError('Un pack no puede contenerse a sí mismo.')
      const item=await tx.objectStore('products').get(content.productId)
      if(!item || (item.isArchived&&!product?.packContents?.some(c=>c.productId===content.productId))) throw new CatalogError('Un producto documentado en el pack no está disponible.')
    }
  }
  private async principalCategory(tx: WriteTransaction, categoryId?: string, product?: CatalogProduct) {
    if (!categoryId) throw new CatalogError('Selecciona una categoría principal antes de guardar.')
    validId(categoryId)
    const category = await tx.objectStore('categories').get(categoryId)
    if (!category || (!category.isActive && product?.categoryId !== categoryId)) throw new CatalogError('La categoría está archivada o ya no está disponible.')
  }
  async createProduct(input: CreateProductInput): Promise<CatalogProduct> {
    validId(input.id); validateFields(input); integer(input.initialStock, 'Stock inicial', true)
    if (input.initialCost !== undefined) integer(input.initialCost, 'Costo inicial')
    return this.write(async tx => {
      const existing = await tx.objectStore('products').get(input.id)
      if (existing) {
        if (JSON.stringify(existing.eventPrices ?? []) !== JSON.stringify(input.eventPrices ?? [])) throw new CatalogError('El identificador ya pertenece a otro producto.')
        if (existing.activeName !== normalizedName(input.name) || existing.price !== input.price || existing.stock !== input.initialStock || existing.lowStockThreshold !== input.lowStockThreshold || existing.lastKnownCost !== input.initialCost || existing.estimatedUnitCost !== input.estimatedUnitCost || existing.categoryId !== input.categoryId || (existing.kind??'product')!==(input.kind??'product') || JSON.stringify(existing.packContents??[])!==JSON.stringify(input.packContents??[]) || JSON.stringify(existing.categoryIds) !== JSON.stringify(input.categoryIds) || JSON.stringify(existing.familyIds ?? existing.categoryIds) !== JSON.stringify(input.familyIds ?? []) || JSON.stringify(existing.ipIds ?? []) !== JSON.stringify(input.ipIds ?? [])) throw new CatalogError('El identificador ya pertenece a otro producto. Cierra el formulario y vuelve a intentarlo.')
        return existing // Reintento con el mismo ID: no crea otro producto/movimiento.
      }
      await this.packReferences(tx,input.id,input)
      const categoryId = input.categoryId
      await this.principalCategory(tx, categoryId)
      await this.classificationsExist(tx, input.familyIds ?? [], input.ipIds ?? [])
      const now = new Date().toISOString()
      const product: CatalogProduct = { kind: input.kind, packContents: input.kind==='pack' ? structuredClone(input.packContents??[]) : undefined, id: input.id, name: input.name.trim(), description: input.description?.trim() || undefined, categoryIds: [...input.categoryIds], categoryId, classificationPending: false, familyIds: [...(input.familyIds ?? [])], ipIds: [...(input.ipIds ?? [])], price: input.price, lowStockThreshold: input.lowStockThreshold, image: input.image, isFavorite: input.isFavorite, stock: input.initialStock, averageCost: input.initialCost, lastKnownCost: input.initialCost, averageCostIsProvisional: input.initialCost === undefined || input.initialStock <= 0, isArchived: false, createdAt: now, updatedAt: now, revision: 1, activeName: normalizedName(input.name) }
      await tx.objectStore('products').add(product)
      if (input.eventPrices !== undefined) { product.eventPrices = structuredClone(input.eventPrices); await tx.objectStore('products').put(product) }
      if (input.estimatedUnitCost !== undefined) {
        product.estimatedUnitCost = input.estimatedUnitCost
        await tx.objectStore('products').put(product)
        await tx.objectStore('costChanges').add({ id: crypto.randomUUID(), productId: product.id, previousValue: undefined, newValue: input.estimatedUnitCost, createdAt: now })
      }
      if (product.stock !== 0) await tx.objectStore('movements').add({ id: crypto.randomUUID(), productId: product.id, type: 'initial', quantityChange: product.stock, previousStock: 0, resultingStock: product.stock, requestedQuantity: product.stock, createdAt: now, unitCost: input.initialCost })
      return product
    })
  }
  async updateProduct(id: string, input: ProductFields, expectedRevision: number, costChangeReason?: string) {
    validId(id); validateFields(input)
    if ((costChangeReason?.length ?? 0) > 500) throw new CatalogError('El motivo del costo admite hasta 500 caracteres.')
    return this.write(async tx => {
      const product = await tx.objectStore('products').get(id)
      if (!product) throw new CatalogError('El producto ya no existe.')
      if (product.revision !== expectedRevision) throw new CatalogError('El producto cambió en otra ventana. Cierra el formulario y vuelve a abrirlo.')
      await this.packReferences(tx,id,input,product)
      const categoryId = input.categoryId ?? product.categoryId
      await this.principalCategory(tx, categoryId, product)
      await this.classificationsExist(tx, input.familyIds ?? product.familyIds ?? [], input.ipIds ?? product.ipIds ?? [], product)
      const updated: CatalogProduct = { ...product, kind: input.kind??product.kind, packContents: (input.kind??product.kind)==='pack'?structuredClone(input.packContents??product.packContents??[]):undefined, name: input.name.trim(), description: input.description?.trim() || undefined, categoryIds: [...input.categoryIds], categoryId, classificationPending: false, familyIds: [...(input.familyIds ?? product.familyIds ?? [])], ipIds: [...(input.ipIds ?? product.ipIds ?? [])], price: input.price, lowStockThreshold: input.lowStockThreshold, image: input.image, isFavorite: input.isFavorite, activeName: product.isArchived ? undefined : normalizedName(input.name), updatedAt: new Date().toISOString(), revision: product.revision + 1 }
      updated.estimatedUnitCost = input.estimatedUnitCost
      if (input.eventPrices !== undefined) updated.eventPrices = structuredClone(input.eventPrices)
      await tx.objectStore('products').put(updated)
      if (product.estimatedUnitCost !== updated.estimatedUnitCost) await tx.objectStore('costChanges').add({ id: crypto.randomUUID(), productId: id, previousValue: product.estimatedUnitCost, newValue: updated.estimatedUnitCost, createdAt: updated.updatedAt, reason: costChangeReason?.trim() || undefined })
      return updated
    })
  }
  async setArchived(id: string, archived: boolean, expectedRevision: number) {
    validId(id)
    return this.write(async tx => {
      const product = await tx.objectStore('products').get(id)
      if (!product) throw new CatalogError('El producto ya no existe.')
      if (product.isArchived === archived) return product
      if (product.revision !== expectedRevision) throw new CatalogError('El producto cambió. Actualiza la lista antes de continuar.')
      const updated = { ...product, isArchived: archived, activeName: archived ? undefined : normalizedName(product.name), updatedAt: new Date().toISOString(), revision: product.revision + 1 }
      await tx.objectStore('products').put(updated)
      return updated
    })
  }
  async saveCategory(input: { id: string; name: string; isActive: boolean; order: number; description?: string }) {
    const previous = await (await this.db()).get('categories', input.id)
    return new ClassificationRepository(this.databaseName).save('categories', { ...input, expectedUpdatedAt: previous?.updatedAt })
  }
  async recordMovement(input: MovementInput): Promise<InventoryMovement> {
    validId(input.id); validId(input.productId); integer(input.quantity, 'Cantidad', true)
    if (!['restock', 'adjustment', 'count'].includes(input.type)) throw new CatalogError('Tipo de movimiento inválido.')
    if (input.type === 'restock' && input.quantity <= 0) throw new CatalogError('La reposición debe agregar al menos una unidad.')
    if (input.type === 'adjustment' && input.quantity === 0) throw new CatalogError('El ajuste debe cambiar al menos una unidad.')
    if (input.unitCost !== undefined) { integer(input.unitCost, 'Costo unitario'); if (input.type !== 'restock') throw new CatalogError('Solo una reposición puede indicar costo unitario.') }
    if ((input.reason?.length ?? 0) > 500) throw new CatalogError('El motivo admite hasta 500 caracteres.')
    return this.write(async tx => {
      const existing = await tx.objectStore('movements').get(input.id)
      if (existing) {
        if (existing.productId !== input.productId || existing.type !== input.type || existing.requestedQuantity !== input.quantity || existing.unitCost !== input.unitCost || existing.reason !== (input.reason?.trim() || undefined)) throw new CatalogError('El identificador ya pertenece a otra operación.')
        return existing
      }
      const product = await tx.objectStore('products').get(input.productId)
      if (!product || product.isArchived) throw new CatalogError('El producto está archivado o no existe.')
      if (product.revision !== input.expectedRevision) throw new CatalogError('El stock cambió. Cierra el formulario y vuelve a abrirlo antes de ajustar.')
      if(product.stockCountPending && input.type!=='count')throw new CatalogError('Registra primero un conteo físico inicial.');
      const change = input.type === 'count' ? input.quantity - product.stock : input.quantity
      const stock = product.stock + change
      integer(stock, 'Stock resultante', true); integer(change, 'Cambio de stock', true)
      const now = new Date().toISOString()
      const cost = input.type === 'restock' ? restockCost(product, change, input.unitCost) : { averageCost: product.averageCost, lastKnownCost: product.lastKnownCost, averageCostIsProvisional: product.averageCostIsProvisional || stock <= 0 || change > 0 }
      const movement: InventoryMovement = { id: input.id, productId: product.id, type: input.type, requestedQuantity: input.quantity, quantityChange: change, previousStock: product.stock, resultingStock: stock, createdAt: now, reason: input.reason?.trim() || undefined, unitCost: input.unitCost }
      movement.previousStockUnknown = product.stockCountPending || undefined
      movement.costBefore = inventoryCosts(product)
      movement.costAfter = inventoryCosts(cost)
      movement.productRevisionAfter = product.revision + 1
      await tx.objectStore('products').put({ ...product, ...cost, stock, stockCountPending: false, updatedAt: now, revision: product.revision + 1 })
      await tx.objectStore('movements').add(movement)
      return movement
    })
  }
  async reverseMovement(input: ReverseMovementInput): Promise<InventoryMovement> {
    validId(input.id); validId(input.movementId)
    const reason = input.reason.trim()
    if (!reason || reason.length > 500) throw new CatalogError('Indica un motivo de reversión de hasta 500 caracteres.')
    return this.write(async tx => {
      const existing = await tx.objectStore('movements').get(input.id)
      if (existing) {
        if (existing.type !== 'manual_reversal' || existing.reversesMovementId !== input.movementId || existing.reason !== reason) throw new CatalogError('El identificador ya pertenece a otra operación.')
        return existing
      }
      const original = await tx.objectStore('movements').get(input.movementId)
      if (!original) throw new CatalogError('El movimiento original no existe.')
      const product = await tx.objectStore('products').get(original.productId)
      if (!product) throw new CatalogError('El producto ya no existe.')
      if (product.revision !== input.expectedRevision) throw new CatalogError('El producto cambió. Cierra la reversión y revisa los valores actuales.')
      const plan = planMovementReversal(product, original)
      const now = new Date().toISOString()
      const movement: InventoryMovement = {
        id: input.id, productId: product.id, type: 'manual_reversal',
        requestedQuantity: plan.quantityChange, quantityChange: plan.quantityChange,
        previousStock: product.stock, resultingStock: plan.stock, createdAt: now, reason,
        unitCost: original.unitCost, reversesMovementId: original.id,
        costBefore: inventoryCosts(product), costAfter: plan.cost,
        productRevisionAfter: product.revision + 1, costReversalPolicy: plan.costReversalPolicy,
      }
      await tx.objectStore('products').put({ ...product, ...plan.cost, stock: plan.stock, updatedAt: now, revision: product.revision + 1 })
      await tx.objectStore('movements').add(movement)
      await tx.objectStore('movements').put({ ...original, reversedById: movement.id })
      return movement
    })
  }
  async movementsFor(productId: string) {
    const db = await this.db()
    const movements = await db.getAllFromIndex('movements', 'by-product', productId)
    return movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async listMovements(filters: { productId?: string; type?: InventoryMovement['type'] } = {}) {
    const db = await this.db()
    const movements = filters.productId ? await db.getAllFromIndex('movements', 'by-product', filters.productId) : await db.getAll('movements')
    return movements.filter(movement => !filters.type || movement.type === filters.type).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async estimatedCostHistory(productId?: string) {
    const db = await this.db()
    const changes = productId ? await db.getAllFromIndex('costChanges', 'by-product', productId) : await db.getAll('costChanges')
    return changes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
}
export const catalogRepository = new CatalogRepository()
