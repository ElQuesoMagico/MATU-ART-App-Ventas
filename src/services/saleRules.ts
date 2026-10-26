import type { CatalogProduct, SaleCostSnapshot } from '../types/catalog.ts'
import { integer } from './catalogValidation.ts'
export interface SaleStockResult {
  quantitySold: number
  previousStock: number
  quantityDeducted: number
  resultingStock: number
  uncoveredQuantity: number
}
/** Solo cálculo: no guarda ventas ni movimientos, ni modifica el carrito. */
export function calculateSaleStock(previousStock: number, quantitySold: number): SaleStockResult {
  integer(previousStock, 'Stock anterior', true)
  integer(quantitySold, 'Cantidad vendida')
  const quantityDeducted = Math.min(Math.max(previousStock, 0), quantitySold)
  return { quantitySold, previousStock, quantityDeducted, resultingStock: previousStock - quantityDeducted, uncoveredQuantity: quantitySold - quantityDeducted }
}
/** Captura histórica de una fuente; el POS utiliza resolveSaleCost. */
export function captureSaleCost(product: CatalogProduct, source: SaleCostSnapshot['source']): SaleCostSnapshot {
  const unitCost = source === 'estimated' ? product.estimatedUnitCost : source === 'average' ? product.averageCost : source === 'last-known' ? product.lastKnownCost : undefined
  return { unitCost, source: unitCost === undefined ? 'unknown' : source, isProvisional: source === 'average' && unitCost !== undefined && product.averageCostIsProvisional }
}
export function defaultCostSource(product: CatalogProduct): SaleCostSnapshot['source'] {
  const valid = (cost?: number) => cost !== undefined && Number.isSafeInteger(cost) && cost >= 0
  if (valid(product.averageCost)) return 'average'
  if (valid(product.estimatedUnitCost)) return 'estimated'
  return valid(product.lastKnownCost) ? 'last-known' : 'unknown'
}

/** Se resuelve dentro de la transacción, nunca por el vendedor. */
export function resolveSaleCost(product: CatalogProduct): SaleCostSnapshot {
  const cost = captureSaleCost(product, defaultCostSource(product))
  return { ...cost, condition: cost.unitCost === undefined ? 'unknown' : cost.isProvisional ? 'provisional' : cost.source === 'estimated' ? 'estimated' : 'known' }
}
