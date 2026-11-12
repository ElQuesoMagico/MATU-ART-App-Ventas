import { z } from 'zod'
import { dataSchema } from '../../data/backupValidation.ts'
import { calculateSaleStock } from '../../saleRules.ts'
import { inventoryBalanceSchema, type InventoryBalance } from './inventoryProtocol.ts'
import type { StoredSale } from '../../../types/sales.ts'
import type { InventoryMovement } from '../../../types/catalog.ts'

// Bounded atomic transactions, including Security Rules document-access limits.
export const MAX_SHARED_SALE_LINES = 5
export const sharedSaleIntentSchema = z.object({
  schemaVersion: z.literal(1), actorUid: z.string().min(1).max(128), deviceId: z.uuid(),
  sale: dataSchema.shape.sales.element,
}).strict()
export interface SharedSaleIntent { schemaVersion: 1; actorUid: string; deviceId: string; sale: StoredSale }
export interface SharedSaleReceipt {
  intent: SharedSaleIntent
  sale: StoredSale
  before: Record<string, InventoryBalance>
  after: Record<string, InventoryBalance>
  movements: InventoryMovement[]
}
/** Preserve the sale's immutable monetary snapshot; serialize only stock effects against current balances. */
export function planSharedSale(raw: SharedSaleIntent, balances: Record<string, InventoryBalance>): SharedSaleReceipt {
  const intent = sharedSaleIntentSchema.parse(raw) as SharedSaleIntent
  const source = intent.sale
  if (source.status !== 'completed' || source.voidAudit || source.historicalSource) throw new Error('Solo se pueden compartir ventas nuevas, no ventas históricas ni anuladas.')
  if (!source.items.length || source.items.length > MAX_SHARED_SALE_LINES) throw new Error(`La venta compartida admite hasta ${MAX_SHARED_SALE_LINES} productos distintos por operación.`)
  const ids = source.items.map(i => i.productId)
  if (new Set(ids).size !== ids.length || source.movementIds.length !== ids.length || new Set(source.movementIds).size !== ids.length) throw new Error('Productos o movimientos repetidos o incompletos.')
  if (source.items.reduce((n, i) => n + BigInt(i.lineTotal), 0n) !== BigInt(source.subtotal) || source.subtotal - source.discount !== source.total) throw new Error('Totales de venta inconsistentes.')
  if (source.payments.reduce((n, p) => n + BigInt(p.amount), 0n) !== BigInt(source.total) || new Set(source.payments.map(p => p.method)).size !== source.payments.length || new Set(source.payments.map(p => p.id)).size !== source.payments.length || source.payments.some(p => p.saleId !== source.id)) throw new Error('Pagos de venta inconsistentes.')
  const before: SharedSaleReceipt['before'] = {}, after: SharedSaleReceipt['after'] = {}, movements: InventoryMovement[] = []
  const items = source.items.map((item, index) => {
    if (item.quantity * item.unitPrice !== item.lineTotal) throw new Error('Precio histórico inconsistente.')
    const current = inventoryBalanceSchema.parse(balances[item.productId])
    if (current.productId !== item.productId || current.countPending) throw new Error('Producto pendiente de incorporación o conteo físico.')
    const stock = calculateSaleStock(current.stock, item.quantity)
    before[item.productId] = current
    after[item.productId] = inventoryBalanceSchema.parse({ ...current, stock: stock.resultingStock, revision: current.revision + 1, operationId: source.operationId,
      costs: { ...current.costs, averageCostIsProvisional: current.costs.averageCostIsProvisional || stock.resultingStock <= 0 } })
    movements.push({ id: source.movementIds[index], productId: item.productId, saleId: source.id, type: 'sale',
      sharedOperationId: source.operationId, sharedStatus: 'confirmed', actorUid: intent.actorUid,
      previousStock: current.stock, resultingStock: stock.resultingStock, quantityChange: -stock.quantityDeducted,
      requestedQuantity: item.quantity, uncoveredQuantity: stock.uncoveredQuantity, unitCost: item.cost.unitCost,
      createdAt: source.soldAt, reason: `Venta ${source.number}` })
    return { ...item, stock }
  })
  return { intent, before, after, movements, sale: { ...source, sharedStatus: 'confirmed', sharedActorUid: intent.actorUid, deviceId: intent.deviceId, items, stockDifferences: items.filter(i => i.stock.uncoveredQuantity > 0).map(i => ({ productId: i.productId, quantity: i.stock.uncoveredQuantity })) } }
}

export const sharedVoidIntentSchema = z.object({ schemaVersion: z.literal(1), operationId: z.uuid(), saleId: z.uuid(), actorUid: z.string().min(1).max(128), deviceId: z.uuid(), occurredAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(1).max(500), returnStock: z.boolean(), movementIds: z.array(z.uuid()).max(MAX_SHARED_SALE_LINES) }).strict()
export type SharedVoidIntent = z.infer<typeof sharedVoidIntentSchema>
export interface SharedVoidReceipt { intent: SharedVoidIntent; sale: StoredSale; before: Record<string, InventoryBalance>; after: Record<string, InventoryBalance>; movements: InventoryMovement[] }
export function planSharedVoid(raw: SharedVoidIntent, original: StoredSale, balances: Record<string, InventoryBalance>): SharedVoidReceipt {
  const intent = sharedVoidIntentSchema.parse(raw)
  if (original.id !== intent.saleId || original.status !== 'completed' || original.voidAudit || original.historicalSource) throw new Error('La venta ya fue anulada o no admite anulación compartida.')
  if (intent.movementIds.length !== (intent.returnStock ? original.items.length : 0) || new Set(intent.movementIds).size !== intent.movementIds.length) throw new Error('Movimientos de devolución incompletos.')
  const before: SharedVoidReceipt['before'] = {}, after: SharedVoidReceipt['after'] = {}, movements: InventoryMovement[] = []
  if (intent.returnStock) original.items.forEach((item, index) => {
    const current = inventoryBalanceSchema.parse(balances[item.productId])
    if (current.productId !== item.productId || current.countPending) throw new Error('Inventario de devolución no disponible.')
    const quantity = item.stock.quantityDeducted
    before[item.productId] = current
    after[item.productId] = inventoryBalanceSchema.parse({ ...current, stock: current.stock + quantity, revision: current.revision + 1, operationId: intent.operationId,
      costs: { ...current.costs, averageCostIsProvisional: current.costs.averageCostIsProvisional || quantity > 0 } })
    movements.push({ id: intent.movementIds[index], productId: item.productId, saleId: original.id, type: 'sale_void',
      sharedOperationId: intent.operationId, sharedStatus: 'confirmed', actorUid: intent.actorUid,
      quantityChange: quantity, previousStock: current.stock, resultingStock: current.stock + quantity, requestedQuantity: quantity,
      unitCost: item.cost.unitCost, reason: intent.reason, createdAt: intent.occurredAt })
  })
  return { intent, before, after, movements, sale: { ...original, status: 'voided', voidActorUid: intent.actorUid, voidAudit: { operationId: intent.operationId, reason: intent.reason, returnStock: intent.returnStock, voidedAt: intent.occurredAt, movementIds: intent.movementIds } } }
}
