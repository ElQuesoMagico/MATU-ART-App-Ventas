import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import { resolveSaleCost } from '../src/services/saleRules.ts'
import { openCatalogDatabase, type CatalogSchema } from '../src/services/catalogDatabase.ts'
import type { CatalogProduct, CreateProductInput } from '../src/types/catalog.ts'
import type { CheckoutInput, PaymentMethod } from '../src/types/sales.ts'
const name = () => `clown-ufo-sales-${crypto.randomUUID()}`
async function setup(overrides: Partial<CreateProductInput> = {}) {
  const dbName = name(); const catalog = new CatalogRepository(dbName); const sales = new SalesRepository(dbName)
  const product = await catalog.createProduct({ id: crypto.randomUUID(), name: 'Lámina A5', categoryIds: [], price: 1000, initialStock: 7, initialCost: 200, lowStockThreshold: 2, isFavorite: false, ...overrides })
  return { dbName, catalog, sales, product }
}
function item(product: CatalogProduct, quantity: number) {
  return { productId: product.id, quantity, unitPrice: product.price, expectedRevision: product.revision }
}
function checkout(product: CatalogProduct, quantity = 3, method: PaymentMethod = 'cash'): CheckoutInput {
  return { operationId: crypto.randomUUID(), items: [item(product, quantity)], payments: [{ method, amount: product.price * quantity }] }
}
for (const method of ['cash', 'transfer', 'debit'] as const) {
  test(`venta normal, pago ${method}, copia histórica y movimientos asociados`, async () => {
    const { catalog, sales, product, dbName } = await setup()
    const sale = await sales.confirm(checkout(product, 3, method))
    assert.equal(sale.number, 1); assert.equal(sale.total, 3000); assert.equal(sale.discount, 0); assert.equal(sale.status, 'completed'); assert.equal(sale.event, undefined)
    assert.equal(sale.items[0].quantity, 3); assert.equal(sale.items[0].name, product.name); assert.equal(sale.items[0].cost.unitCost, 200)
    assert.equal((await catalog.snapshot()).products[0].stock, 4)
    const movements = await catalog.listMovements({ type: 'sale', productId: product.id })
    assert.equal(movements.length, 1); assert.equal(movements[0].saleId, sale.id); assert.equal(movements[0].quantityChange, -3)
    const db = await openCatalogDatabase(dbName)
    assert.equal((await db.getAllFromIndex('payments', 'by-sale', sale.id))[0].method, method); db.close()
    await catalog.close(); await sales.close()
  })
}
for (const [stock, quantity, finalStock, uncovered] of [[7, 8, 0, 1], [0, 5, 0, 5], [-2, 5, -2, 5]]) {
  test(`venta con stock ${stock}, cantidad ${quantity}: conserva cantidades y registra diferencia`, async () => {
    const { catalog, sales, product } = await setup({ initialStock: stock })
    const sale = await sales.confirm(checkout(product, quantity))
    assert.equal(sale.items[0].quantity, quantity); assert.equal(sale.items[0].stock.resultingStock, finalStock); assert.equal(sale.stockDifferences[0].quantity, uncovered)
    assert.equal((await catalog.snapshot()).products[0].stock, finalStock)
    const movement = (await catalog.listMovements({ type: 'sale' }))[0]
    assert.equal(movement.requestedQuantity, quantity); assert.equal(movement.uncoveredQuantity, uncovered)
    await catalog.close(); await sales.close()
  })
}
test('varios productos, pago dividido exacto y numeración consecutiva', async () => {
  const { catalog, sales, product } = await setup()
  const other = await catalog.createProduct({ id: crypto.randomUUID(), name: 'Sticker', categoryIds: [], price: 500, initialStock: 2, initialCost: 0, lowStockThreshold: 1, isFavorite: true })
  const sale = await sales.confirm({ operationId: crypto.randomUUID(), items: [item(product, 2), item(other, 2)], payments: [{ method: 'cash', amount: 1000 }, { method: 'transfer', amount: 1500 }, { method: 'debit', amount: 500 }] })
  assert.equal(sale.total, 3000); assert.equal(sale.items.length, 2); assert.equal(sale.payments.length, 3); assert.equal(sale.items[1].cost.unitCost, 0)
  const fresh = (await catalog.snapshot()).products.find(value => value.id === product.id)!
  assert.equal((await sales.confirm(checkout(fresh, 1))).number, 2)
  await catalog.close(); await sales.close()
})
test('pagos inválidos o suma incorrecta no guardan venta, pagos ni stock parcial', async () => {
  const { catalog, sales, product, dbName } = await setup()
  for (const amount of [-1, 1.5, NaN, 2999, 3001]) await assert.rejects(sales.confirm({ ...checkout(product), payments: [{ method: 'cash', amount }] }))
  await assert.rejects(sales.confirm({ ...checkout(product), payments: [{ method: 'cash', amount: 1000 }, { method: 'transfer', amount: 1000 }] }))
  assert.equal((await sales.snapshot()).sales.length, 0); assert.equal((await catalog.snapshot()).products[0].stock, 7)
  const db = await openCatalogDatabase(dbName); assert.equal((await db.getAll('payments')).length, 0); assert.equal(await db.get('metadata', 'sale-number'), undefined); db.close()
  await catalog.close(); await sales.close()
})
test('doble confirmación/reintento con operación estable crea una sola venta', async () => {
  const { catalog, sales, product, dbName } = await setup(); const other = new SalesRepository(dbName); const request = checkout(product)
  const [first, second] = await Promise.all([sales.confirm(request), other.confirm(request)])
  assert.equal(first.id, second.id); assert.equal((await sales.snapshot()).sales.length, 1); assert.equal((await catalog.snapshot()).products[0].stock, 4)
  assert.equal((await catalog.listMovements({ type: 'sale' })).length, 1)
  await assert.rejects(sales.confirm({ ...request, items: [item(product, 1)], payments: [{ method: 'cash', amount: 1000 }] }))
  await catalog.close(); await sales.close(); await other.close()
})
test('fallo al guardar un pago revierte venta, movimiento, contador y producto', async () => {
  const { catalog, sales, product, dbName } = await setup()
  const original = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) { if (this.name === 'payments') throw new DOMException('Disco lleno', 'QuotaExceededError'); return original.call(this, value, key) }
  const request = checkout(product)
  try { await assert.rejects(sales.confirm(request)); assert.equal((await catalog.snapshot()).products[0].stock, 7); assert.equal((await sales.snapshot()).sales.length, 0); assert.equal((await catalog.listMovements({ type: 'sale' })).length, 0) }
  finally { IDBObjectStore.prototype.add = original }
  const sale = await sales.confirm(request); assert.equal(sale.number, 1)
  const db = await openCatalogDatabase(dbName); assert.equal((await db.getAll('payments')).length, 1); db.close()
  await catalog.close(); await sales.close()
})
test('persistencia y modificaciones de nombre/precio/costo/archivo no alteran ventas anteriores', async () => {
  const { catalog, sales, product, dbName } = await setup()
  const saved = await sales.confirm(checkout(product))
  let current = (await catalog.snapshot()).products[0]
  current = await catalog.updateProduct(current.id, { ...current, name: 'Nombre nuevo', price: 9000, estimatedUnitCost: 2500 }, current.revision, 'Nueva impresora')
  await catalog.recordMovement({ id: crypto.randomUUID(), productId: current.id, type: 'restock', quantity: 4, unitCost: 1000, expectedRevision: current.revision })
  current = (await catalog.snapshot()).products[0]; await catalog.setArchived(current.id, true, current.revision)
  await sales.close(); await catalog.close()
  const reopened = new SalesRepository(dbName)
  assert.deepEqual((await reopened.snapshot()).sales[0], saved)
  assert.equal(saved.items[0].name, 'Lámina A5'); assert.equal(saved.items[0].unitPrice, 1000); assert.equal(saved.items[0].cost.unitCost, 200)
  await reopened.close()
})
for (const returnStock of [false, true]) {
  test(`anulación returnStock=${returnStock}, idempotente y auditada`, async () => {
    const { catalog, sales, product } = await setup()
    const sale = await sales.confirm(checkout(product, 8))
    const request = { saleId: sale.id, operationId: crypto.randomUUID(), reason: 'Compra cancelada', returnStock }
    const [first, retry] = await Promise.all([sales.voidSale(request), sales.voidSale(request)])
    assert.equal(first.status, 'voided'); assert.deepEqual(first, retry); assert.deepEqual(first.items, sale.items); assert.deepEqual(first.payments, sale.payments)
    assert.equal((await catalog.snapshot()).products[0].stock, returnStock ? 7 : 0)
    assert.equal((await catalog.listMovements({ type: 'sale_void' })).length, returnStock ? 1 : 0)
    await assert.rejects(sales.voidSale({ ...request, operationId: crypto.randomUUID() }))
    assert.equal((await catalog.snapshot()).products[0].stock, returnStock ? 7 : 0)
    await catalog.close(); await sales.close()
  })
}
test('anulación con producto archivado devuelve stock sin restaurarlo, y falla atómicamente', async () => {
  const { catalog, sales, product } = await setup(); const sale = await sales.confirm(checkout(product))
  let current = (await catalog.snapshot()).products[0]; current = await catalog.setArchived(current.id, true, current.revision)
  const request = { saleId: sale.id, operationId: crypto.randomUUID(), reason: 'Error de registro', returnStock: true }
  const original = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) { if (this.name === 'movements') throw new DOMException('Disco lleno', 'QuotaExceededError'); return original.call(this, value, key) }
  try { await assert.rejects(sales.voidSale(request)); assert.equal((await sales.snapshot()).sales[0].status, 'completed'); assert.equal((await catalog.snapshot()).products[0].stock, 4) }
  finally { IDBObjectStore.prototype.add = original }
  await sales.voidSale(request); current = (await catalog.snapshot()).products[0]
  assert.equal(current.stock, 7); assert.equal(current.isArchived, true)
  await catalog.close(); await sales.close()
})
test('costos desconocidos, estimados y provisionales se copian sin asumir cero', async () => {
  const unknown = await setup({ initialCost: undefined }); const missing = await unknown.sales.confirm(checkout(unknown.product, 1))
  assert.equal(missing.items[0].cost.source, 'unknown'); assert.equal(missing.items[0].cost.unitCost, undefined)
  const estimated = await setup({ initialCost: undefined, estimatedUnitCost: 750 }); const estimate = await estimated.sales.confirm(checkout(estimated.product, 1))
  assert.equal(estimate.items[0].cost.source, 'estimated'); assert.equal(estimate.items[0].cost.unitCost, 750)
  const provisional = await setup({ initialStock: 0 }); const result = await provisional.sales.confirm(checkout(provisional.product, 1))
  assert.equal(result.items[0].cost.isProvisional, true)
  for (const context of [unknown, estimated, provisional]) { await context.catalog.close(); await context.sales.close() }
})
test('sin evento real no asocia demostración; evento real se copia; revisión obsoleta se rechaza', async () => {
  const { catalog, sales, product, dbName } = await setup()
  const db = await openCatalogDatabase(dbName); const eventId = crypto.randomUUID()
  await db.put('events', { id: crypto.randomUUID(), name: 'Evento anterior', isActive: true, createdAt: new Date().toISOString() }); db.close()
  assert.equal((await sales.snapshot()).realEvents.length, 0)
  const events = new EventRepository(dbName)
  const event = await events.save(eventId, { name: 'Evento real', startDate: '2026-10-13', endDate: '2026-10-13' })
  await events.activate(eventId, event.updatedAt)
  const sale = await sales.confirm(checkout(product, 1))
  assert.equal(sale.event?.name, 'Evento real'); assert.equal(sale.event?.id, eventId)
  await assert.rejects(sales.confirm(checkout(product, 1)))
  await catalog.close(); await sales.close()
})
test('migración desde versión 2 conserva catálogo, movimientos y auditoría de estimados', async () => {
  const dbName = name()
  const old = await openDB<CatalogSchema>(dbName, 2, { upgrade(db) {
    db.createObjectStore('products', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
    db.createObjectStore('categories', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
    db.createObjectStore('movements', { keyPath: 'id' }).createIndex('by-product', 'productId')
    db.createObjectStore('costChanges', { keyPath: 'id' }).createIndex('by-product', 'productId')
  } })
  const now = new Date().toISOString(); const product: CatalogProduct = { id: crypto.randomUUID(), name: 'Existente', activeName: 'existente', price: 500, categoryIds: [], stock: 7, lowStockThreshold: 1, estimatedUnitCost: 100, averageCost: 150, lastKnownCost: 200, averageCostIsProvisional: false, isFavorite: false, isArchived: false, revision: 2, createdAt: now, updatedAt: now }
  const change = { id: crypto.randomUUID(), productId: product.id, previousValue: undefined, newValue: 100, reason: 'Costo inicial', createdAt: now }
  const movement = { id: crypto.randomUUID(), productId: product.id, type: 'initial' as const, quantityChange: 7, previousStock: 0, resultingStock: 7, requestedQuantity: 7, createdAt: now }
  await old.put('products', product); await old.put('costChanges', change); await old.put('movements', movement); old.close()
  const catalog = new CatalogRepository(dbName); const sales = new SalesRepository(dbName)
  assert.deepEqual((await catalog.snapshot()).products, [{ ...product, familyIds: product.categoryIds, ipIds: [], categoryId: product.categoryIds.length === 1 ? product.categoryIds[0] : undefined, classificationPending: product.categoryIds.length !== 1 }]); assert.deepEqual(await catalog.estimatedCostHistory(product.id), [change]); assert.deepEqual(await catalog.movementsFor(product.id), [movement]); assert.equal((await sales.snapshot()).sales.length, 0)
  await catalog.close(); await sales.close()
})
test('confirmar y anular con las APIs de red deshabilitadas', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Sin conexión') }
  try { const { catalog, sales, product } = await setup(); const sale = await sales.confirm(checkout(product, 1)); await sales.voidSale({ saleId: sale.id, operationId: crypto.randomUUID(), reason: 'Anulación offline', returnStock: true }); assert.equal((await catalog.snapshot()).products[0].stock, 7); await catalog.close(); await sales.close() }
  finally { globalThis.fetch = original }
})

for (const [label, values, expected] of [
  ['promedio conocido', { averageCost: 200, estimatedUnitCost: 300, lastKnownCost: 400, averageCostIsProvisional: false }, { unitCost: 200, source: 'average', condition: 'known', isProvisional: false }],
  ['promedio provisional', { averageCost: 200, estimatedUnitCost: 300, averageCostIsProvisional: true }, { unitCost: 200, source: 'average', condition: 'provisional', isProvisional: true }],
  ['estimado antes del ultimo', { averageCost: undefined, estimatedUnitCost: 0, lastKnownCost: 400 }, { unitCost: 0, source: 'estimated', condition: 'estimated', isProvisional: false }],
  ['ultimo conocido', { averageCost: undefined, estimatedUnitCost: undefined, lastKnownCost: 400 }, { unitCost: 400, source: 'last-known', condition: 'known', isProvisional: false }],
  ['desconocido', { averageCost: undefined, estimatedUnitCost: undefined, lastKnownCost: undefined }, { unitCost: undefined, source: 'unknown', condition: 'unknown', isProvisional: false }],
] as const) {
  test(`costo automatico al confirmar: ${label}`, async () => {
    const { dbName, catalog, sales, product } = await setup()
    const db = await openCatalogDatabase(dbName)
    await db.put('products', { ...product, ...values })
    const sale = await sales.confirm(checkout(product, 1))
    assert.deepEqual(sale.items[0].cost, expected)
    await sales.close()
    const reopened = new SalesRepository(dbName)
    assert.deepEqual((await reopened.snapshot()).sales[0].items[0].cost, expected)
    db.close(); await reopened.close(); await catalog.close()
  })
}
test('promedios invalidos no convierten costos desconocidos en cero', async () => {
  const { catalog, sales, product } = await setup()
  assert.equal(resolveSaleCost({ ...product, averageCost: NaN, estimatedUnitCost: 250 }).source, 'estimated')
  assert.equal(resolveSaleCost({ ...product, averageCost: -1, estimatedUnitCost: undefined, lastKnownCost: undefined }).unitCost, undefined)
  await catalog.close(); await sales.close()
})

test('archivado consultable y editable, reactivacion conserva UUID, costos y movimientos tras reapertura', async () => {
  const { dbName, catalog, sales, product } = await setup({ estimatedUnitCost: 300 })
  const movements = await catalog.movementsFor(product.id)
  let archived = await catalog.setArchived(product.id, true, product.revision)
  assert.equal((await catalog.snapshot()).products.filter(p => p.isArchived).length, 1)
  await assert.rejects(sales.confirm(checkout(archived, 1)))
  archived = await catalog.updateProduct(product.id, { name: 'Lamina archivada editada', categoryIds: [], price: 1200, lowStockThreshold: 2, isFavorite: false, estimatedUnitCost: 350 }, archived.revision, 'Proceso nuevo')
  assert.equal(archived.isArchived, true)
  const restored = await catalog.setArchived(product.id, false, archived.revision)
  await catalog.close()
  const reopened = new CatalogRepository(dbName)
  const persisted = (await reopened.snapshot()).products[0]
  assert.deepEqual(persisted, restored)
  assert.equal(persisted.id, product.id); assert.equal(persisted.averageCost, product.averageCost); assert.equal(persisted.lastKnownCost, product.lastKnownCost)
  assert.deepEqual(await reopened.movementsFor(product.id), movements)
  assert.equal((await reopened.estimatedCostHistory(product.id)).find(change => change.reason === 'Proceso nuevo')?.newValue, 350)
  const sale = await sales.confirm(checkout(persisted, 1)); assert.equal(sale.items[0].productId, product.id)
  await reopened.close(); await sales.close()
})
