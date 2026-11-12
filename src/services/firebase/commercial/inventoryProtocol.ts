import { z } from 'zod'
import { restockCost } from '../../catalogValidation.ts'

const amount = z.number().int().min(0).max(1_000_000_000)
const signed = z.number().int().min(-1_000_000_000).max(1_000_000_000)
const revision = z.number().int().min(0).max(1_000_000_000)
export const inventoryCostsSchema = z.object({
  averageCost: amount.nullable(), lastKnownCost: amount.nullable(),
  estimatedUnitCost: amount.nullable(), averageCostIsProvisional: z.boolean(),
}).strict()
export const inventoryBalanceSchema = z.object({
  productId: z.uuid(), stock: signed, countPending: z.boolean(), revision: revision.min(1),
  costs: inventoryCostsSchema, operationId: z.uuid(),
}).strict()
export const inventoryIntentSchema = z.object({
  schemaVersion: z.literal(1), operationId: z.uuid(), productId: z.uuid(), deviceId: z.uuid(),
  actorUid: z.string().min(1).max(128), occurredAt: z.iso.datetime({ offset: true }),
  expectedRevision: revision, type: z.enum(['initialize', 'count', 'adjustment', 'restock']),
  quantity: signed, unitCost: amount.nullable(), reason: z.string().max(500),
}).strict().superRefine((value, context) => {
  if (value.type === 'initialize' && (value.quantity !== 0 || value.expectedRevision !== 0)) {
    context.addIssue({ code: 'custom', message: 'La apertura comienza pendiente de conteo, sin copiar cantidades locales.' })
  }
  if (value.type === 'restock' && value.quantity <= 0) context.addIssue({ code: 'custom', message: 'La reposición requiere unidades positivas.' })
  if (value.type !== 'restock' && value.unitCost !== null) context.addIssue({ code: 'custom', message: 'El costo unitario corresponde a una reposición.' })
})
export type InventoryIntent = z.infer<typeof inventoryIntentSchema>
export type InventoryBalance = z.infer<typeof inventoryBalanceSchema>
export interface InventoryReceipt {
  intent: InventoryIntent
  before: InventoryBalance | null
  after: InventoryBalance
  quantityChange: number
}

/** Pure planner, not a server trust boundary. Never reads local stock as authority. */
export function planInventory(raw: InventoryIntent, current: InventoryBalance | null): InventoryReceipt {
  const intent = inventoryIntentSchema.parse(raw)
  const before = current === null ? null : inventoryBalanceSchema.parse(current)
  if ((before?.revision ?? 0) !== intent.expectedRevision || (before && before.productId !== intent.productId)) {
    throw new Error('El inventario cambió en otro dispositivo. Revisa la operación antes de compartirla.')
  }
  if (intent.type === 'initialize') {
    if (before) throw new Error('El inventario ya está incorporado.')
    return { intent, before: null, quantityChange: 0, after: {
      productId: intent.productId, stock: 0, countPending: true, revision: 1, operationId: intent.operationId,
      costs: { averageCost: null, lastKnownCost: null, estimatedUnitCost: null, averageCostIsProvisional: true },
    } }
  }
  if (!before) throw new Error('Incorpora primero el inventario del producto.')
  if (before.countPending && intent.type !== 'count') throw new Error('Registra primero un conteo físico.')
  const stock = signed.parse(intent.type === 'count' ? intent.quantity : before.stock + intent.quantity)
  const quantityChange = signed.parse(stock - before.stock)
  const computed = intent.type === 'restock'
    ? restockCost({ stock: before.stock, averageCost: before.costs.averageCost ?? undefined,
      lastKnownCost: before.costs.lastKnownCost ?? undefined, averageCostIsProvisional: before.costs.averageCostIsProvisional },
    quantityChange, intent.unitCost ?? undefined)
    : { averageCost: before.costs.averageCost ?? undefined, lastKnownCost: before.costs.lastKnownCost ?? undefined,
      averageCostIsProvisional: before.costs.averageCostIsProvisional || stock <= 0 || quantityChange > 0 }
  const after = inventoryBalanceSchema.parse({ ...before, stock, countPending: false,
    revision: before.revision + 1, operationId: intent.operationId,
    costs: { ...before.costs, ...computed, averageCost: computed.averageCost ?? null, lastKnownCost: computed.lastKnownCost ?? null },
  })
  return { intent, before, after, quantityChange }
}

/** Transport state is separate from durable confirmation. Designed for a future atomic local outbox. */
export type CommercialDeliveryState = 'pending' | 'sending' | 'confirmed' | 'conflict' | 'review' | 'error'
export interface CommercialPendingOperation {
  operationId: string
  workspaceId: string
  intent: InventoryIntent
  state: CommercialDeliveryState
  attempts: number
  dependencies: string[]
  lastError?: string
  confirmedAt?: string
}
