import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { CatalogRepository } from './catalogFixture.ts'
import { CATALOG_DB_VERSION, openCatalogDatabase, type CatalogSchema } from '../src/services/catalogDatabase.ts'
import type { CreateProductInput } from '../src/types/catalog.ts'
const name = () => `clown-ufo-stage25-${crypto.randomUUID()}`
const draft = (): CreateProductInput => ({ id: crypto.randomUUID(), name: 'Lámina', categoryIds: [], price: 5000, initialStock: 7, initialCost: 1000, lowStockThreshold: 2, isFavorite: false })
test('costo estimado independiente, auditado, desconocido/cero, y persistente tras reapertura', async () => {
  const dbName = name(); const repo = new CatalogRepository(dbName)
  const product = await repo.createProduct(draft())
  const before = await repo.movementsFor(product.id)
  let current = await repo.updateProduct(product.id, { ...product, estimatedUnitCost: 2000 }, product.revision, 'Nuevo papel')
  assert.equal(current.averageCost, 1000); assert.equal(current.lastKnownCost, 1000); assert.equal(current.stock, 7)
  assert.deepEqual(await repo.movementsFor(product.id), before)
  let changes = await repo.estimatedCostHistory(product.id)
  assert.equal(changes.length, 1); assert.equal(changes[0].previousValue, undefined); assert.equal(changes[0].newValue, 2000); assert.equal(changes[0].reason, 'Nuevo papel'); assert(changes[0].createdAt)
  await repo.updateProduct(current.id, { ...current }, current.revision)
  current = (await repo.snapshot()).products[0]
  assert.equal((await repo.estimatedCostHistory(product.id)).length, 1)
  await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'restock', quantity: 7, unitCost: 3000, expectedRevision: current.revision })
  current = (await repo.snapshot()).products[0]
  assert.equal(current.averageCost, 2000); assert.equal(current.lastKnownCost, 3000); assert.equal(current.estimatedUnitCost, 2000)
  current = await repo.updateProduct(current.id, { ...current, estimatedUnitCost: 0 }, current.revision, 'Producción sin costo')
  assert.equal(current.averageCost, 2000); assert.equal(current.lastKnownCost, 3000)
  await repo.close()
  const reopened = new CatalogRepository(dbName)
  current = (await reopened.snapshot()).products[0]
  assert.equal(current.estimatedUnitCost, 0)
  current = await reopened.updateProduct(current.id, { ...current, estimatedUnitCost: undefined }, current.revision, 'Sin estimación')
  changes = await reopened.estimatedCostHistory(current.id)
  assert.equal(changes.length, 3)
  assert(changes.some(change => change.previousValue === 2000 && change.newValue === 0))
  assert(changes.some(change => change.previousValue === 0 && change.newValue === undefined))
  await assert.rejects(reopened.updateProduct(current.id, { ...current, estimatedUnitCost: -1 }, current.revision))
  await assert.rejects(reopened.updateProduct(current.id, { ...current, estimatedUnitCost: 1.5 }, current.revision))
  await reopened.setArchived(current.id, true, current.revision)
  assert.equal((await reopened.listMovements({ productId: current.id, type: 'restock' })).length, 1)
  assert.equal((await reopened.listMovements({ type: 'initial' })).length, 1)
  assert.equal((await reopened.estimatedCostHistory(current.id)).length, 3)
  await reopened.close()
})
test('migración desde versión 1 no modifica productos, categorías, imágenes ni movimientos', async () => {
  const dbName = name()
  const oldDb = await openDB<CatalogSchema>(dbName, 1, { upgrade(db) {
    db.createObjectStore('products', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
    db.createObjectStore('categories', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
    db.createObjectStore('movements', { keyPath: 'id' }).createIndex('by-product', 'productId')
  } })
  const categoryId = crypto.randomUUID(); const productId = crypto.randomUUID(); const movementId = crypto.randomUUID(); const now = '2026-10-12T12:00:00Z'
  const category = { id: categoryId, name: 'Prints', activeName: 'prints', isActive: true, order: 1, createdAt: now, updatedAt: now }
  const product = { id: productId, name: 'Producto existente', activeName: 'producto existente', categoryIds: [categoryId], price: 5000, stock: 7, lowStockThreshold: 2, averageCost: 1000, lastKnownCost: 1500, averageCostIsProvisional: false, isArchived: true, isFavorite: true, createdAt: now, updatedAt: now, revision: 3, image: new Blob(['original'], { type: 'image/png' }) }
  const movement = { id: movementId, productId, type: 'initial' as const, quantityChange: 7, previousStock: 0, resultingStock: 7, requestedQuantity: 7, unitCost: 1000, createdAt: now }
  await oldDb.put('categories', category); await oldDb.put('products', product); await oldDb.put('movements', movement); oldDb.close()
  const repo = new CatalogRepository(dbName)
  const snapshot = await repo.snapshot()
  assert.deepEqual(snapshot.products[0], { ...product, familyIds: product.categoryIds, ipIds: [], categoryId: product.categoryIds.length === 1 ? product.categoryIds[0] : undefined, classificationPending: product.categoryIds.length !== 1 }); assert.deepEqual(snapshot.categories[0], { ...category, normalizedName: category.name.toLocaleLowerCase('es-CL') })
  assert.equal(snapshot.products[0].estimatedUnitCost, undefined)
  assert.equal(await snapshot.products[0].image?.text(), 'original')
  assert.deepEqual(await repo.listMovements({ productId }), [movement])
  assert.deepEqual(await repo.estimatedCostHistory(productId), [])
  const db = await openCatalogDatabase(dbName)
  assert.equal(db.version, CATALOG_DB_VERSION); assert(db.objectStoreNames.contains('costChanges')); db.close()
  const updated = await repo.updateProduct(productId, { ...product, estimatedUnitCost: 2300 }, product.revision, 'Nueva máquina')
  assert.equal(updated.id, productId); assert.equal(updated.stock, 7); assert.equal(updated.averageCost, 1000); assert.equal(updated.lastKnownCost, 1500)
  assert.deepEqual(await repo.movementsFor(productId), [movement])
  await repo.close()
})
test('fallo de auditoría revierte el cambio de costo y revisión del producto', async () => {
  const repo = new CatalogRepository(name()); const product = await repo.createProduct(draft())
  const originalAdd = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) { if (this.name === 'costChanges') throw new DOMException('Disco lleno', 'QuotaExceededError'); return originalAdd.call(this, value, key) }
  try { await assert.rejects(repo.updateProduct(product.id, { ...product, estimatedUnitCost: 2200 }, product.revision)); assert.deepEqual((await repo.snapshot()).products[0], product); assert.equal((await repo.estimatedCostHistory(product.id)).length, 0) }
  finally { IDBObjectStore.prototype.add = originalAdd; await repo.close() }
})
