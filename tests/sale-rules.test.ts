import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateSaleStock, captureSaleCost } from '../src/services/saleRules.ts'
import type { CatalogProduct } from '../src/types/catalog.ts'
for (const [stock, sold, deducted, resulting, shortage] of [[7, 8, 7, 0, 1], [7, 3, 3, 4, 0], [0, 5, 0, 0, 5], [-2, 5, 0, -2, 5], [7, 0, 0, 7, 0]]) {
  test(`stock ${stock}, venta ${sold}: final ${resulting}, diferencia ${shortage}`, () => {
    assert.deepEqual(calculateSaleStock(stock, sold), { quantitySold: sold, previousStock: stock, quantityDeducted: deducted, resultingStock: resulting, uncoveredQuantity: shortage })
  })
}
test('la regla rechaza cantidades negativas/fraccionarias y stock inválido', () => {
  assert.throws(() => calculateSaleStock(7, -1))
  assert.throws(() => calculateSaleStock(7, 1.5))
  assert.throws(() => calculateSaleStock(NaN, 1))
})
test('la copia de costo conserva cero, fuente e incertidumbre sin cambiar con el producto', () => {
  const product: CatalogProduct = { id: crypto.randomUUID(), name: 'Prueba', categoryIds: [], price: 5000, stock: 7, lowStockThreshold: 2, averageCost: 1000, lastKnownCost: 1500, estimatedUnitCost: 0, averageCostIsProvisional: true, isArchived: false, isFavorite: false, createdAt: '', updatedAt: '', revision: 1 }
  const captured = captureSaleCost(product, 'estimated')
  product.estimatedUnitCost = 2500
  assert.deepEqual(captured, { unitCost: 0, source: 'estimated', isProvisional: false })
  assert.deepEqual(captureSaleCost(product, 'average'), { unitCost: 1000, source: 'average', isProvisional: true })
  product.estimatedUnitCost = undefined
  assert.deepEqual(captureSaleCost(product, 'estimated'), { unitCost: undefined, source: 'unknown', isProvisional: false })
})
