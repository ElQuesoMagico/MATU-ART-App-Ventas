import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { openCatalogDatabase, type CatalogSchema } from './catalogDatabase.ts'
import { CatalogError, integer, validId } from './catalogValidation.ts'
import { calculatePromotionPricing, promotionPricingSignature, type PromotionLine } from './promotionRules.ts'
import { calculateSaleStock, resolveSaleCost } from './saleRules.ts'
import { resolveProductPrice, samePriceContext } from './productPricing.ts'
import type { CheckoutInput, StoredSale, StoredSaleItem, VoidSaleInput } from '../types/sales.ts'
type SaleTransaction = IDBPTransaction<CatalogSchema, ['products', 'sales', 'payments', 'movements', 'metadata', 'events', 'promotions', 'managedEvents'], 'readwrite'>
export function saleMoney(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new CatalogError(`${label}: ingresa un importe entero válido, mayor o igual a cero.`)
}
const fingerprint = (input: CheckoutInput) => JSON.stringify({ items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)), payments: [...input.payments].sort((a, b) => a.method.localeCompare(b.method)), eventId: input.eventId ?? null, generalDiscount: input.generalDiscount, pricingSignature: input.pricingSignature, priceReview: input.priceReview })
export class SalesRepository {
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
    const db = await this.db(); const tx = db.transaction(['sales', 'managedEvents', 'metadata'], 'readonly')
    const [sales, realEvents, revision] = await Promise.all([tx.objectStore('sales').getAll(), tx.objectStore('managedEvents').getAll(), tx.objectStore('metadata').get('event-price-revision')]); await tx.done
    return { sales: sales.sort((a, b) => b.number - a.number), realEvents, eventRevision: revision?.value ?? 0 }
  }
  private async write<T>(work: (tx: SaleTransaction) => Promise<T>) {
    const db = await this.db(); const tx = db.transaction(['products', 'sales', 'payments', 'movements', 'metadata', 'events', 'promotions', 'managedEvents'], 'readwrite')
    const completion = tx.done; void completion.catch(() => {})
    try { const result = await work(tx); await completion; return result }
    catch (error) { try { tx.abort() } catch { /* Ya finalizada. */ } await completion.catch(() => {}); throw error }
  }
  async confirm(input: CheckoutInput): Promise<StoredSale> {
    validId(input.operationId)
    if (!input.items.length || new Set(input.items.map(item => item.productId)).size !== input.items.length) throw new CatalogError('El carrito está vacío o tiene productos repetidos.')
    for (const item of input.items) {
      validId(item.productId); integer(item.quantity, 'Cantidad vendida'); saleMoney(item.unitPrice, 'Precio')
      if (item.quantity === 0) throw new CatalogError('Cada producto debe tener al menos una unidad.')
    }
    if (new Set(input.payments.map(payment => payment.method)).size !== input.payments.length) throw new CatalogError('Selecciona métodos de pago sin repetirlos.')
    for (const payment of input.payments) { if (!['cash', 'transfer', 'debit'].includes(payment.method)) throw new CatalogError('Método de pago inválido.'); saleMoney(payment.amount, 'Pago') }
    return this.write(async tx => {
      const key = fingerprint(input)
      const existing = await tx.objectStore('sales').index('by-operation').get(input.operationId)
      if (existing) { if (existing.operationFingerprint !== key) throw new CatalogError('Esta operación ya corresponde a otra venta.'); return existing }
      const activeEvent = await tx.objectStore('managedEvents').index('active-event').get('active')
      const eventRevision = (await tx.objectStore('metadata').get('event-price-revision'))?.value ?? 0
      if (input.priceReview && !samePriceContext(input.priceReview, { eventId: activeEvent?.id ?? null, revision: eventRevision })) throw new CatalogError('El evento cambió durante el pago. Vuelve al carrito para revisar precios y total.')
      const items: StoredSaleItem[] = []
      const pricingLines: PromotionLine[] = []
      let subtotal = 0
      for (const item of input.items) {
        const product = await tx.objectStore('products').get(item.productId)
        if (!product || product.isArchived) throw new CatalogError('Un producto fue archivado o ya no existe. Regresa al carrito para revisarlo.')
        if (product.stockCountPending) throw new CatalogError('Producto pendiente de conteo físico inicial.');
        const cost = resolveSaleCost(product)
        const priceSnapshot = resolveProductPrice(product, activeEvent?.id)
        if (product.revision !== item.expectedRevision || priceSnapshot.unitPrice !== item.unitPrice) throw new CatalogError('El catálogo o precio del evento cambió desde la revisión del pago. Regresa al carrito y revisa precio, costo y stock antes de confirmar.')
        const lineTotal = priceSnapshot.unitPrice * item.quantity; saleMoney(lineTotal, 'Subtotal del producto'); subtotal += lineTotal; saleMoney(subtotal, 'Subtotal')
        pricingLines.push({ productId: product.id, quantity: item.quantity, unitPrice: priceSnapshot.unitPrice, hasEventPrice: priceSnapshot.source === 'event', discount: item.discount, categoryId: product.categoryId, familyIds: product.familyIds, ipIds: product.ipIds })
        const packContents = product.kind==='pack' ? await Promise.all((product.packContents??[]).map(async content=>({ ...content, name:(await tx.objectStore('products').get(content.productId))?.name??'Producto no disponible' }))) : undefined
        items.push({ priceSnapshot, productKind:product.kind,packContents,productId: product.id, name: product.name, description: product.description, categoryIds: [...product.categoryIds], quantity: item.quantity, unitPrice: priceSnapshot.unitPrice, lineTotal, cost: { ...cost }, stock: calculateSaleStock(product.stock, item.quantity) })
      }
      const transactionTime = new Date().toISOString()
      const pricing = calculatePromotionPricing(pricingLines, await tx.objectStore('promotions').getAll(), input.generalDiscount, transactionTime, activeEvent?.id)
      if (input.pricingSignature && input.pricingSignature !== promotionPricingSignature(pricing)) throw new CatalogError('Las promociones cambiaron o vencieron durante el pago. Vuelve al carrito y revisa el total.')
      items.forEach((item, index) => { item.appliedDiscount = pricing.lines[index].appliedDiscount; item.netLineTotal = pricing.lines[index].netAmount; item.promotionDiscount = pricing.lines[index].promotionDiscount })
      const paid = input.payments.reduce((sum, payment) => sum + BigInt(payment.amount), 0n)
      if (paid !== BigInt(pricing.total)) throw new CatalogError('Los pagos deben sumar exactamente el total de la venta.')
      let event: StoredSale['event']
      // Bloquea el mismo almacén que activación/finalización. Asociación vigente
      // al confirmar; nunca depende de un selector o de la copia del carrito.
      if (activeEvent) event = { id: activeEvent.id, name: activeEvent.name }
      const counter = await tx.objectStore('metadata').get('sale-number')
      const number = (counter?.value ?? 0) + 1; saleMoney(number, 'Número de venta')
      const now = transactionTime; const saleId = crypto.randomUUID()
      const payments = input.payments.map(payment => ({ ...payment, id: crypto.randomUUID(), saleId, createdAt: now }))
      const movementIds: string[] = []
      for (const item of items) {
        const product = (await tx.objectStore('products').get(item.productId))!
        const movementId = crypto.randomUUID(); movementIds.push(movementId)
        await tx.objectStore('products').put({ ...product, stock: item.stock.resultingStock, revision: product.revision + 1, updatedAt: now, averageCostIsProvisional: product.averageCostIsProvisional || item.stock.resultingStock <= 0 })
        await tx.objectStore('movements').add({ id: movementId, productId: item.productId, type: 'sale', quantityChange: -item.stock.quantityDeducted, previousStock: item.stock.previousStock, resultingStock: item.stock.resultingStock, requestedQuantity: item.quantity, uncoveredQuantity: item.stock.uncoveredQuantity, saleId, unitCost: item.cost.unitCost, reason: `Venta ${number}`, createdAt: now })
      }
      const sale: StoredSale = { id: saleId, operationId: input.operationId, operationFingerprint: key, number, soldAt: now, createdAt: now, items, subtotal, discount: pricing.discount, generalDiscount: pricing.appliedGeneralDiscount, calculationVersion: pricing.combos.length ? 'combos-v1' : pricing.promotions.length ? 'promotions-v1' : 'manual-v1', appliedPromotions: pricing.promotions, appliedCombos: pricing.combos, total: pricing.total, payments, event, status: 'completed', stockDifferences: items.filter(item => item.stock.uncoveredQuantity > 0).map(item => ({ productId: item.productId, quantity: item.stock.uncoveredQuantity })), movementIds }
      await tx.objectStore('sales').add(sale)
      for (const payment of payments) await tx.objectStore('payments').add(payment)
      await tx.objectStore('metadata').put({ key: 'sale-number', value: number })
      return sale
    })
  }
  async voidSale(input: VoidSaleInput): Promise<StoredSale> {
    validId(input.saleId); validId(input.operationId)
    if (!input.reason.trim() || input.reason.trim().length > 500) throw new CatalogError('Indica el motivo de anulación (hasta 500 caracteres).')
    if (typeof input.returnStock !== 'boolean') throw new CatalogError('Indica si se debe devolver el stock.')
    return this.write(async tx => {
      const sale = await tx.objectStore('sales').get(input.saleId)
      if (!sale) throw new CatalogError('La venta no existe.')
      if (sale.historicalSource && input.returnStock) throw new CatalogError('Una venta importada no descontó stock local; no admite devolución de existencias.');
      if (sale.status === 'voided') {
        if (sale.voidAudit?.operationId === input.operationId && sale.voidAudit.reason === input.reason.trim() && sale.voidAudit.returnStock === input.returnStock) return sale
        throw new CatalogError('La venta ya fue anulada. No se devolvió stock nuevamente.')
      }
      const now = new Date().toISOString(); const movementIds: string[] = []
      if (input.returnStock) for (const item of sale.items) {
        const product = await tx.objectStore('products').get(item.productId)
        if (!product) throw new CatalogError('No se puede devolver el stock: falta un producto original.')
        // Se devuelve solo lo descontado, nunca unidades de la diferencia no cubierta.
        const stock = product.stock + item.stock.quantityDeducted; integer(stock, 'Stock devuelto', true)
        const movementId = crypto.randomUUID(); movementIds.push(movementId)
        await tx.objectStore('products').put({ ...product, stock, revision: product.revision + 1, updatedAt: now, averageCostIsProvisional: product.averageCostIsProvisional || item.stock.quantityDeducted > 0 })
        await tx.objectStore('movements').add({ id: movementId, productId: product.id, type: 'sale_void', quantityChange: item.stock.quantityDeducted, previousStock: product.stock, resultingStock: stock, requestedQuantity: item.stock.quantityDeducted, saleId: sale.id, unitCost: item.cost.unitCost, reason: input.reason.trim(), createdAt: now })
      }
      const updated: StoredSale = { ...sale, status: 'voided', voidAudit: { operationId: input.operationId, reason: input.reason.trim(), returnStock: input.returnStock, voidedAt: now, movementIds } }
      await tx.objectStore('sales').put(updated)
      return updated
    })
  }
}
export const salesRepository = new SalesRepository()
