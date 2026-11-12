import test from 'node:test'
import assert from 'node:assert/strict'
import { planSharedSale, planSharedVoid, type SharedSaleIntent } from '../src/services/firebase/commercial/saleProtocol.ts'
import type { InventoryBalance } from '../src/services/firebase/commercial/inventoryProtocol.ts'
export function saleFixture(quantity = 2, stock = 10) {
  const productId = crypto.randomUUID(), saleId = crypto.randomUUID(), now = new Date().toISOString()
  const balance: InventoryBalance = { productId, stock, countPending: false, revision: 1, operationId: crypto.randomUUID(), costs: { averageCost: null, lastKnownCost: null, estimatedUnitCost: null, averageCostIsProvisional: true } }
  const intent: SharedSaleIntent = { schemaVersion: 1, actorUid: 'a', deviceId: crypto.randomUUID(), sale: {
    id: saleId, operationId: crypto.randomUUID(), operationFingerprint: 'fixture', number: 1, soldAt: now, createdAt: now,
    items: [{ productId, name: 'Sticker', categoryIds: [], quantity, unitPrice: 600, lineTotal: quantity * 600, cost: { source: 'unknown', isProvisional: false }, stock: { previousStock: stock, resultingStock: stock - quantity, quantityDeducted: quantity, quantitySold: quantity, uncoveredQuantity: 0 } }],
    subtotal: quantity * 600, discount: 0, total: quantity * 600, status: 'completed', stockDifferences: [], movementIds: [crypto.randomUUID()], payments: [{ id: crypto.randomUUID(), saleId, createdAt: now, method: 'cash', amount: quantity * 600 }],
  } }
  return { intent, balance }
}
test('shared sales serialize stock without recalculating historical money or costs', () => {
  const { intent, balance } = saleFixture(), first = planSharedSale(intent, { [balance.productId]: balance })
  const second = structuredClone(intent); second.sale.id = crypto.randomUUID(); second.sale.operationId = crypto.randomUUID(); second.sale.payments[0].saleId = second.sale.id
  second.sale.items[0].quantity = 3; second.sale.items[0].lineTotal = 1800; second.sale.total = second.sale.subtotal = second.sale.payments[0].amount = 1800
  const next = planSharedSale(second, first.after)
  assert.equal(next.after[balance.productId].stock, 5)
  assert.deepEqual(next.sale.items[0].cost, second.sale.items[0].cost)
  assert.equal(balance.stock, 10)
})
for (const stock of [0, 1, -2]) test(`shared sale preserves oversell trace for stock ${stock}`, () => {
  const { intent, balance } = saleFixture(3, stock), receipt = planSharedSale(intent, { [balance.productId]: balance })
  assert.equal(receipt.after[balance.productId].stock, Math.min(stock, 0))
  assert.equal(receipt.sale.items[0].stock.uncoveredQuantity, 3 - Math.max(stock, 0))
})
test('void returns only confirmed deducted quantities and preserves historical payments', () => {
  const { intent, balance } = saleFixture(8, 7), sold = planSharedSale(intent, { [balance.productId]: balance })
  const voidIntent = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), saleId: sold.sale.id, actorUid: 'a', deviceId: intent.deviceId, occurredAt: new Date().toISOString(), reason: 'Error', returnStock: true, movementIds: [crypto.randomUUID()] }
  const cancelled = planSharedVoid(voidIntent, sold.sale, sold.after)
  assert.equal(cancelled.after[balance.productId].stock, 7)
  assert.deepEqual(cancelled.sale.payments, sold.sale.payments)
  assert.throws(() => planSharedVoid(voidIntent, cancelled.sale, cancelled.after), /anulada/)
  const noReturn = planSharedVoid({ ...voidIntent, returnStock: false, movementIds: [] }, sold.sale, {})
  assert.deepEqual(noReturn.after, {})
})
test('shared sale rejects unknown stock, corrupt amounts and duplicate lines', () => {
  const { intent, balance } = saleFixture()
  assert.throws(() => planSharedSale(intent, { [balance.productId]: { ...balance, countPending: true } }), /conteo/)
  assert.throws(() => planSharedSale({ ...intent, sale: { ...intent.sale, total: 0 } }, { [balance.productId]: balance }), /Totales/)
  assert.throws(() => planSharedSale({ ...intent, sale: { ...intent.sale, items: [...intent.sale.items, ...intent.sale.items] } }, { [balance.productId]: balance }), /repetidos/)
})
