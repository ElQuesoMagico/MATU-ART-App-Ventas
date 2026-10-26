import type { CatalogProduct, InventoryCostState, InventoryMovement } from '../types/catalog.ts'
import { CatalogError, integer } from './catalogValidation.ts'

export function inventoryCosts(product: InventoryCostState): InventoryCostState {
  return { averageCost: product.averageCost, lastKnownCost: product.lastKnownCost, averageCostIsProvisional: product.averageCostIsProvisional }
}
export function canReverseMovement(movement: InventoryMovement) {
  return !movement.previousStockUnknown && ['restock', 'adjustment', 'count'].includes(movement.type) && !movement.saleId && !movement.reversedById && movement.quantityChange !== 0
}
/** Compensates the original delta against CURRENT stock, never restores an old stock balance. */
export function planMovementReversal(product: CatalogProduct, movement: InventoryMovement) {
  if (movement.productId !== product.id || !canReverseMovement(movement)) throw new CatalogError('Este movimiento no admite reversión o ya fue revertido.')
  const quantityChange = -movement.quantityChange
  const stock = product.stock + quantityChange
  integer(quantityChange, 'Cambio de stock', true); integer(stock, 'Stock resultante', true)
  const matchesCosts = movement.costAfter && Object.entries(inventoryCosts(product)).every(([key, value]) => movement.costAfter?.[key as keyof InventoryCostState] === value)
  const restorable = !!movement.costBefore && !!matchesCosts && product.revision === movement.productRevisionAfter && product.stock === movement.resultingStock
  const costReversalPolicy = restorable ? 'restored' as const : 'provisional' as const
  const cost = restorable ? inventoryCosts(movement.costBefore!) : { ...inventoryCosts(product), averageCostIsProvisional: true }
  if (cost.averageCost !== undefined) integer(cost.averageCost, 'Costo promedio')
  if (cost.lastKnownCost !== undefined) integer(cost.lastKnownCost, 'Último costo')
  return { quantityChange, stock, cost, costReversalPolicy }
}
