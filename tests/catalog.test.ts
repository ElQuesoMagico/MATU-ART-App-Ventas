import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CatalogRepository } from './catalogFixture.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { storageError } from '../src/services/catalogValidation.ts'
import type { CreateProductInput } from '../src/types/catalog.ts'

function input(overrides: Partial<CreateProductInput> = {}): CreateProductInput {
  return { id: crypto.randomUUID(), name: 'Print Lunar', categoryIds: [], price: 6000, initialStock: 10, initialCost: 1000, lowStockThreshold: 3, isFavorite: false, ...overrides }
}
const name = () => `clown-ufo-test-${crypto.randomUUID()}`
test('base vacía, categorías múltiples, edición, imagen, reapertura y origen separado', async () => {
  const databaseName = name()
  const repo = new CatalogRepository(databaseName)
  assert.deepEqual(await repo.snapshot(), { products: [], categories: [] })
  const cat1 = await repo.saveCategory({ id: crypto.randomUUID(), name: 'Prints', isActive: true, order: 2 })
  const cat2 = await repo.saveCategory({ id: crypto.randomUUID(), name: 'Favoritos', isActive: true, order: 1 })
  const created = await repo.createProduct(input({ categoryIds: [cat1.id, cat2.id], image: new Blob(['photo'], { type: 'image/png' }) }))
  const edits = { ...created, stock: 500, name: 'Print Lunar A5', price: 7000 }
  const edited = await repo.updateProduct(created.id, edits, created.revision)
  assert.equal(edited.stock, 10)
  await repo.close()
  const reopened = new CatalogRepository(databaseName)
  const snapshot = await reopened.snapshot()
  assert.equal(snapshot.products[0].id, created.id)
  assert.equal(snapshot.products[0].name, 'Print Lunar A5')
  assert.equal(snapshot.products[0].price, 7000)
  assert.equal(await snapshot.products[0].image?.text(), 'photo')
  assert.deepEqual(snapshot.products[0].categoryIds, [cat1.id, cat2.id])
  assert.deepEqual(snapshot.categories.map(item => item.id), [cat2.id, cat1.id])
  const renamed = await reopened.saveCategory({ ...cat1, name: 'Láminas' })
  await reopened.saveCategory({ ...renamed, isActive: false })
  assert.equal((await reopened.snapshot()).products[0].categoryIds[0], cat1.id)
  assert.equal((await new CatalogRepository(name()).snapshot()).products.length, 0)
  await reopened.close()
})
test('duplicados normalizados y concurrentes, ID idempotente, validaciones y rollback', async () => {
  const dbName = name(); const repo = new CatalogRepository(dbName); const other = new CatalogRepository(dbName)
  const draft = input()
  const [first, retry] = await Promise.all([repo.createProduct(draft), other.createProduct(draft)])
  assert.equal(first.id, retry.id)
  assert.equal((await repo.movementsFor(first.id)).length, 1)
  await assert.rejects(repo.createProduct(input({ name: '  PRINT   LUNAR  ' })))
  await assert.rejects(repo.createProduct({ ...draft, name: 'Otro' }))
  await assert.rejects(repo.createProduct(input({ name: ' ' })))
  await assert.rejects(repo.createProduct(input({ name: 'Precio negativo', price: -1 })))
  await assert.rejects(repo.createProduct(input({ name: 'Fracción', price: 1.5 })))
  await assert.rejects(repo.createProduct(input({ name: 'Stock fracción', initialStock: 2.5 })))
  await assert.rejects(repo.createProduct(input({ name: 'Costo inválido', initialCost: -1 })))
  await assert.rejects(repo.createProduct(input({ name: 'Categoría inválida', categoryIds: [crypto.randomUUID()] })))
  assert.equal((await repo.snapshot()).products.length, 1)
  assert.equal((await repo.movementsFor(first.id)).length, 1)
  await assert.rejects(repo.updateProduct(first.id, { ...first, price: 1 }, 0))
  await repo.close(); await other.close()
})
test('reposición ponderada, ajuste negativo, conteo, historial y reintento exactamente una vez', async () => {
  const repo = new CatalogRepository(name())
  const product = await repo.createProduct(input())
  const request = { id: crypto.randomUUID(), productId: product.id, type: 'restock' as const, quantity: 10, unitCost: 2000, expectedRevision: product.revision, reason: 'Compra' }
  await Promise.all([repo.recordMovement(request), repo.recordMovement(request)])
  let current = (await repo.snapshot()).products[0]
  assert.equal(current.stock, 20); assert.equal(current.averageCost, 1500); assert.equal(current.lastKnownCost, 2000)
  assert.equal((await repo.movementsFor(product.id)).length, 2)
  await assert.rejects(repo.recordMovement({ ...request, quantity: 11 }))
  await repo.recordMovement({ id: crypto.randomUUID(), productId: current.id, type: 'adjustment', quantity: -25, expectedRevision: current.revision })
  current = (await repo.snapshot()).products[0]
  assert.equal(current.stock, -5); assert.equal(current.lastKnownCost, 2000); assert.equal(current.averageCostIsProvisional, true)
  await repo.recordMovement({ id: crypto.randomUUID(), productId: current.id, type: 'count', quantity: 3, expectedRevision: current.revision })
  current = (await repo.snapshot()).products[0]
  assert.equal(current.stock, 3)
  const history = await repo.movementsFor(product.id)
  assert.equal(history.length, 4)
  const count = history.find(item => item.type === 'count')!
  assert.equal(count.previousStock, -5); assert.equal(count.resultingStock, 3); assert.equal(count.quantityChange, 8)
  assert(history.every(item => item.previousStock + item.quantityChange === item.resultingStock))
  await repo.close()
})
test('costo cero, desconocido y stock no positivo conservan información sin falsos promedios', async () => {
  const repo = new CatalogRepository(name())
  const zero = await repo.createProduct(input({ name: 'Gratis', initialStock: 0, initialCost: 0 }))
  assert.equal(zero.averageCost, 0); assert.equal(zero.lastKnownCost, 0)
  await repo.recordMovement({ id: crypto.randomUUID(), productId: zero.id, type: 'restock', quantity: 2, unitCost: 0, expectedRevision: zero.revision })
  let current = (await repo.snapshot()).products.find(item => item.id === zero.id)!
  assert.equal(current.averageCost, 0); assert.equal(current.averageCostIsProvisional, false)
  await repo.recordMovement({ id: crypto.randomUUID(), productId: current.id, type: 'restock', quantity: 3, expectedRevision: current.revision })
  current = (await repo.snapshot()).products.find(item => item.id === zero.id)!
  assert.equal(current.averageCost, 0); assert.equal(current.lastKnownCost, 0); assert.equal(current.averageCostIsProvisional, true)
  const unknown = await repo.createProduct(input({ name: 'Desconocido', initialCost: undefined }))
  assert.equal(unknown.averageCost, undefined)
  await repo.recordMovement({ id: crypto.randomUUID(), productId: unknown.id, type: 'restock', quantity: 1, unitCost: 2500, expectedRevision: unknown.revision })
  current = (await repo.snapshot()).products.find(item => item.id === unknown.id)!
  assert.equal(current.averageCost, 2500); assert.equal(current.averageCostIsProvisional, true)
  const negative = await repo.createProduct(input({ name: 'Negativo', initialStock: -2 }))
  await repo.recordMovement({ id: crypto.randomUUID(), productId: negative.id, type: 'restock', quantity: 5, unitCost: 3000, expectedRevision: negative.revision })
  current = (await repo.snapshot()).products.find(item => item.id === negative.id)!
  assert.equal(current.stock, 3); assert.equal(current.averageCost, 3000); assert.equal(current.averageCostIsProvisional, true)
  await repo.close()
})
test('archivar conserva movimientos, excluye activos y restaurar valida nombres', async () => {
  const repo = new CatalogRepository(name())
  const original = await repo.createProduct(input())
  const archived = await repo.setArchived(original.id, true, original.revision)
  assert.equal((await repo.snapshot()).products.filter(product => !product.isArchived).length, 0)
  assert.equal((await repo.movementsFor(original.id)).length, 1)
  await repo.createProduct(input())
  await assert.rejects(repo.setArchived(archived.id, false, archived.revision))
  await assert.rejects(repo.recordMovement({ id: crypto.randomUUID(), productId: archived.id, type: 'count', quantity: 3, expectedRevision: archived.revision }))
  await repo.close()
})
test('fallo del almacén de movimientos revierte también el stock del producto', async () => {
  const dbName = name(); const repo = new CatalogRepository(dbName)
  const product = await repo.createProduct(input())
  const db = await openCatalogDatabase(dbName)
  const tx = db.transaction(['products', 'movements'], 'readwrite')
  const completion = tx.done.catch(() => {})
  await tx.objectStore('products').put({ ...product, stock: 500 })
  const movement = (await tx.objectStore('movements').getAll())[0]
  await assert.rejects(tx.objectStore('movements').add(movement))
  await completion
  assert.equal((await repo.snapshot()).products[0].stock, 10)
  db.close(); await repo.close()
})
test('operaciones sin red y errores de almacenamiento comprensibles', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Conexión de red desactivada') }
  try {
    const repo = new CatalogRepository(name())
    const category = await repo.saveCategory({ id: crypto.randomUUID(), name: 'Sin red', isActive: true, order: 0 })
    const product = await repo.createProduct(input({ categoryIds: [category.id] }))
    const edited = await repo.updateProduct(product.id, { ...product, price: 8000 }, product.revision)
    await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'restock', quantity: 2, unitCost: 500, expectedRevision: edited.revision })
    let current = (await repo.snapshot()).products[0]
    await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'adjustment', quantity: -15, expectedRevision: current.revision })
    current = (await repo.snapshot()).products[0]
    await repo.recordMovement({ id: crypto.randomUUID(), productId: product.id, type: 'count', quantity: 5, expectedRevision: current.revision })
    current = (await repo.snapshot()).products[0]
    assert.equal(current.price, 8000); assert.equal(current.stock, 5)
    await repo.saveCategory({ ...category, name: 'Categoría offline', isActive: false })
    await repo.setArchived(current.id, true, current.revision)
    assert.equal((await repo.movementsFor(product.id)).length, 4)
    await repo.close()
  } finally { globalThis.fetch = originalFetch }
  assert.match(storageError(new DOMException('quota', 'QuotaExceededError')), /espacio/)
  assert.match(storageError(new DOMException('denied', 'SecurityError')), /permisos/)
})
test('un error de cuota al escribir el movimiento aborta la creación completa', async () => {
  const repo = new CatalogRepository(name())
  const originalAdd = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'movements') throw new DOMException('Disco lleno', 'QuotaExceededError')
    return originalAdd.call(this, value, key)
  }
  try {
    await assert.rejects(repo.createProduct(input()), { name: 'QuotaExceededError' })
    assert.equal((await repo.snapshot()).products.length, 0)
  } finally { IDBObjectStore.prototype.add = originalAdd; await repo.close() }
})
