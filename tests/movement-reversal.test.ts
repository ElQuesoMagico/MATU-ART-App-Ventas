import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { planMovementReversal } from '../src/services/movementReversal.ts'

async function setup(initialCost: number | undefined = 100) {
  const name = `reversal-${crypto.randomUUID()}`
  const repo = new CatalogRepository(name)
  const product = await repo.createProduct({ id: crypto.randomUUID(), name: 'Prueba', categoryIds: [], price: 500, initialStock: 5, initialCost, estimatedUnitCost: 300, lowStockThreshold: 1, isFavorite: true })
  const current = async () => (await repo.snapshot()).products[0]
  return { name, repo, product, current }
}
test('reposición: reversión atómica, vínculos, costos restaurados y persistencia sin migración', async () => {
  const { name, repo, product, current } = await setup()
  const movement = await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'restock', quantity: 5, unitCost: 200, expectedRevision: 1 })
  assert.equal((await current()).averageCost, 150)
  const reverse = await repo.reverseMovement({ id: crypto.randomUUID(), movementId: movement.id, expectedRevision: 2, reason: 'Ingreso erróneo' })
  const result = await current()
  assert.equal(result.stock, 5); assert.equal(result.averageCost, 100); assert.equal(result.lastKnownCost, 100); assert.equal(result.estimatedUnitCost, 300)
  assert.equal(reverse.costReversalPolicy, 'restored'); assert.equal(reverse.reversesMovementId, movement.id)
  assert.deepEqual((await repo.movementsFor(product.id)).find(m => m.id === movement.id), { ...movement, reversedById: reverse.id })
  await repo.close()
  const reopened = new CatalogRepository(name)
  assert.deepEqual((await reopened.snapshot()).products[0], result)
  assert.deepEqual((await reopened.movementsFor(product.id)).find(m => m.id === reverse.id), reverse)
  const db = await openCatalogDatabase(name); assert.equal(db.version, 10); db.close(); await reopened.close()
})
test('ajuste negativo y conteo se compensan por delta; no por saldo original', async () => {
  const { repo, product, current } = await setup()
  const adjustment = await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'adjustment', quantity: -2, expectedRevision: 1 })
  await repo.reverseMovement({ id: crypto.randomUUID(), movementId: adjustment.id, expectedRevision: 2, reason: 'Corregir ajuste' })
  assert.equal((await current()).stock, 5)
  const count = await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'count', quantity: 8, expectedRevision: 3 })
  await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'adjustment', quantity: -7, expectedRevision: 4 })
  const reverse = await repo.reverseMovement({ id: crypto.randomUUID(), movementId: count.id, expectedRevision: 5, reason: 'Conteo erróneo' })
  assert.equal(reverse.previousStock, 1); assert.equal(reverse.resultingStock, -2); assert.equal(reverse.quantityChange, -3)
  assert.equal(reverse.costReversalPolicy, 'provisional'); assert.equal((await current()).averageCost, 100)
  await repo.close()
})
test('doble clic, reintentos y reversiones concurrentes no duplican stock', async () => {
  const { name, repo, product, current } = await setup()
  const other = new CatalogRepository(name)
  const movement = await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'restock', quantity: 2, expectedRevision: 1 })
  const input = { id: crypto.randomUUID(), movementId: movement.id, expectedRevision: 2, reason: 'Duplicado' }
  const [one, two] = await Promise.all([repo.reverseMovement(input), other.reverseMovement(input)])
  assert.deepEqual(one, two); assert.equal((await current()).stock, 5)
  await assert.rejects(other.reverseMovement({ ...input, id: crypto.randomUUID(), expectedRevision: 3 }), /ya fue revertido/)
  await assert.rejects(repo.reverseMovement({ ...input, reason: 'Distinto' }), /otra operación/)
  await assert.rejects(repo.reverseMovement({ ...input, id: crypto.randomUUID(), movementId: one.id, expectedRevision: 3 }))
  assert.equal((await repo.listMovements({ type: 'manual_reversal' })).length, 1)
  await repo.close(); await other.close()
})
test('movimientos antiguos sin copia de costos conservan valores y marcan provisional', async () => {
  const { name, repo, product, current } = await setup()
  const movement = await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'restock', quantity: 5, unitCost: 200, expectedRevision: 1 })
  delete movement.costBefore; delete movement.costAfter; delete movement.productRevisionAfter
  const db = await openCatalogDatabase(name); await db.put('movements', movement); db.close()
  await repo.reverseMovement({ id: crypto.randomUUID(), movementId: movement.id, expectedRevision: 2, reason: 'Movimiento antiguo' })
  assert.equal((await current()).averageCost, 150); assert.equal((await current()).lastKnownCost, 200); assert.equal((await current()).averageCostIsProvisional, true)
  await repo.close()
})
test('costo desconocido y costo cero siguen distintos al revertir', async () => {
  for (const value of [0, undefined]) {
    const { repo, product, current } = await setup(value)
    const movement = { id: crypto.randomUUID(), productId: product.id, type: 'restock' as const, quantityChange: 2, previousStock: 5, resultingStock: 7, requestedQuantity: 2, createdAt: new Date().toISOString(), costBefore: { averageCost: value, lastKnownCost: value, averageCostIsProvisional: value === undefined }, costAfter: { averageCost: 200, lastKnownCost: 200, averageCostIsProvisional: false }, productRevisionAfter: 2 }
    const plan = planMovementReversal({ ...await current(), stock: 7, revision: 2, ...movement.costAfter }, movement)
    assert.equal(plan.cost.averageCost, value); assert.equal(plan.cost.lastKnownCost, value)
    await repo.close()
  }
})
test('ventas y anulaciones no se revierten como ajustes; historial y pagos intactos', async () => {
  const { name, repo, product, current } = await setup(); const sales = new SalesRepository(name)
  const sale = await sales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: product.id, quantity: 7, unitPrice: 500, expectedRevision: 1, discount: { type: 'fixed', value: 500 } }], payments: [{ method: 'cash', amount: 1000 }, { method: 'transfer', amount: 2000 }] })
  const movement = (await repo.listMovements({ type: 'sale' }))[0]
  await assert.rejects(repo.reverseMovement({ id: crypto.randomUUID(), movementId: movement.id, expectedRevision: 2, reason: 'No permitido' }))
  const voided = await sales.voidSale({ saleId: sale.id, operationId: crypto.randomUUID(), reason: 'Prueba anulación', returnStock: true })
  assert.equal((await current()).stock, 5); assert.deepEqual(voided.items, sale.items); assert.deepEqual(voided.payments, sale.payments)
  const voidMovement = (await repo.listMovements({ type: 'sale_void' }))[0]
  await assert.rejects(repo.reverseMovement({ id: crypto.randomUUID(), movementId: voidMovement.id, expectedRevision: 3, reason: 'No permitido' }))
  await assert.rejects(sales.voidSale({ saleId: sale.id, operationId: crypto.randomUUID(), reason: 'Otra anulación', returnStock: true }))
  await repo.close(); await sales.close()
})
test('producto archivado puede compensarse y reactivarse sin perder sus datos', async () => {
  const { name, repo, product, current } = await setup()
  const movement = await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'adjustment', quantity: -1, expectedRevision: 1 })
  await repo.setArchived(product.id, true, 2)
  await repo.reverseMovement({ id: crypto.randomUUID(), movementId: movement.id, expectedRevision: 3, reason: 'Corrección' })
  assert.equal((await current()).isArchived, true)
  const active = await repo.setArchived(product.id, false, 4)
  assert.equal(active.id, product.id); assert.equal(active.stock, 5); assert.deepEqual(active.categoryIds, product.categoryIds); assert.equal(active.estimatedUnitCost, 300)
  await repo.close(); const reopened = new CatalogRepository(name)
  assert.deepEqual((await reopened.snapshot()).products[0], active); assert.equal((await reopened.movementsFor(product.id)).length, 3); await reopened.close()
})
test('validaciones y error de escritura abortan producto, original y compensación juntos', async () => {
  const { repo, product, current } = await setup()
  const movement = await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'restock', quantity: 2, expectedRevision: 1 })
  const before = await current(); const input = { id: crypto.randomUUID(), movementId: movement.id, expectedRevision: 2, reason: 'Error' }
  await assert.rejects(repo.reverseMovement({ ...input, reason: ' ' }))
  await assert.rejects(repo.reverseMovement({ ...input, expectedRevision: 1 }))
  const add = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(value, key) { if (this.name === 'movements') throw new DOMException('Sin espacio', 'QuotaExceededError'); return add.call(this, value, key) }
  try { await assert.rejects(repo.reverseMovement(input), /Sin espacio/) } finally { IDBObjectStore.prototype.add = add }
  assert.deepEqual(await current(), before)
  assert.deepEqual((await repo.movementsFor(product.id)).find(m => m.id === movement.id), movement)
  assert.equal((await repo.listMovements({ type: 'manual_reversal' })).length, 0)
  await repo.close()
})
