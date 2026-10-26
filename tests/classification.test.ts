import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { CatalogRepository } from './catalogFixture.ts'
import { ClassificationRepository } from '../src/services/classificationRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase, CATALOG_DB_VERSION, type CatalogSchema } from '../src/services/catalogDatabase.ts'
import { matchesClassifications } from '../src/services/catalogClassification.ts'
import type { ClassificationKind } from '../src/types/catalog.ts'
const databaseName = () => `classification-${crypto.randomUUID()}`
const draft = (name = 'Ilustraciones') => ({ id: crypto.randomUUID(), name, description: 'Descripcion', order: 0, isActive: true })
const productInput = () => ({ id: crypto.randomUUID(), name: 'Lamina', categoryIds: [], price: 2000, lowStockThreshold: 2, isFavorite: false, initialStock: 7, initialCost: 500, estimatedUnitCost: 600 })
for (const kind of ['families', 'ips'] as ClassificationKind[]) test(`${kind}: crear, editar, buscar, ordenar, archivar, reactivar y persistir`, async () => {
  const name = databaseName(); const repo = new ClassificationRepository(name)
  const original = await repo.save(kind, draft('  Ilustraciones  '))
  assert.equal(original.name, 'Ilustraciones')
  await assert.rejects(repo.save(kind, draft('ILUSTRACIONES')))
  const other = await repo.save(kind, { ...draft('Otro'), order: 1 })
  let item = await repo.save(kind, { ...original, name: 'Nueva', description: 'Editada', order: 5, expectedUpdatedAt: original.updatedAt })
  assert.equal(item.id, original.id); assert.equal(item.createdAt, original.createdAt)
  assert.deepEqual((await repo.snapshot())[kind].map(i => i.id), [other.id, original.id])
  item = await repo.save(kind, { ...item, isActive: false, expectedUpdatedAt: item.updatedAt })
  await assert.rejects(repo.save(kind, draft(' nueva ')))
  const archived = item
  item = await repo.save(kind, { ...item, isActive: true, expectedUpdatedAt: item.updatedAt })
  await assert.rejects(repo.save(kind, { ...archived, expectedUpdatedAt: archived.updatedAt }))
  assert.deepEqual((await new ClassificationRepository(name).snapshot())[kind].find(i => i.id === item.id), item)
})
test('nombres independientes, duplicados concurrentes y validacion', async () => {
  const repo = new ClassificationRepository(databaseName())
  await repo.save('families', draft('Universo')); await repo.save('ips', draft('Universo'))
  const results = await Promise.allSettled([repo.save('families', draft(' Sticker ')), repo.save('families', draft('STICKER'))])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  for (const patch of [{ name: '' }, { order: -1 }, { order: 1.2 }, { description: 'x'.repeat(2001) }]) await assert.rejects(repo.save('ips', { ...draft(), ...patch }))
})
test('multiples asociaciones sin afectar stock, costos, imagen ni movimientos; archivadas conservadas', async () => {
  const name = databaseName(); const repo = new ClassificationRepository(name); const catalog = new CatalogRepository(name)
  const familyA = await repo.save('families', draft('Laminas')); const familyB = await repo.save('families', draft('Regalos'))
  const ipA = await repo.save('ips', draft('Original')); const ipB = await repo.save('ips', draft('Universo'))
  const original = await catalog.createProduct({ ...productInput(), image: new Blob(['original'], { type: 'image/png' }), familyIds: [familyA.id, familyB.id], ipIds: [ipA.id, ipB.id] })
  const movements = await catalog.movementsFor(original.id); const costs = await catalog.estimatedCostHistory(original.id)
  await repo.save('families', { ...familyA, isActive: false, expectedUpdatedAt: familyA.updatedAt })
  await repo.save('ips', { ...ipA, isActive: false, expectedUpdatedAt: ipA.updatedAt })
  let updated = await catalog.updateProduct(original.id, { ...original, description: 'Otra descripcion' }, original.revision)
  assert.equal(updated.stock, original.stock); assert.equal(updated.price, original.price); assert.equal(updated.averageCost, original.averageCost); assert.equal(updated.lastKnownCost, original.lastKnownCost); assert.equal(updated.estimatedUnitCost, original.estimatedUnitCost)
  assert.deepEqual(updated.image, original.image); assert.deepEqual(await catalog.movementsFor(original.id), movements); assert.deepEqual(await catalog.estimatedCostHistory(original.id), costs)
  await assert.rejects(catalog.createProduct({ ...productInput(), name: 'Nuevo', familyIds: [familyA.id] }))
  await assert.rejects(catalog.createProduct({ ...productInput(), name: 'Nuevo', ipIds: [ipA.id] }))
  updated = await catalog.updateProduct(original.id, { ...updated, familyIds: [familyB.id], ipIds: [ipB.id] }, updated.revision)
  await assert.rejects(catalog.updateProduct(original.id, { ...updated, familyIds: [familyA.id] }, updated.revision))
  await assert.rejects(catalog.updateProduct(original.id, { ...updated, ipIds: [ipB.id, ipB.id] }, updated.revision))
  await catalog.close(); const reopened = new CatalogRepository(name)
  assert.deepEqual((await reopened.snapshot()).products[0], updated); await reopened.close()
})
test('OR en cada grupo, AND entre grupos, y productos sin clasificacion', async () => {
  const catalog = new CatalogRepository(databaseName()); const product = await catalog.createProduct(productInput())
  const classified = { ...product, familyIds: ['a', 'b'], ipIds: ['x', 'y'] }
  assert.equal(matchesClassifications(classified, ['z', 'b'], ['y', 'w']), true)
  assert.equal(matchesClassifications(classified, ['a'], ['z']), false)
  assert.equal(matchesClassifications(classified, [], ['x']), true)
  assert.equal(matchesClassifications(classified, ['a'], []), true)
  assert.equal(matchesClassifications(product, [], []), true)
  assert.equal(matchesClassifications(product, ['a'], []), false)
  await catalog.close()
})
test('migracion v3 a v4 preserva datos completos e IDs, es repetible y permite vender', async () => {
  const sourceName = databaseName(); const source = new CatalogRepository(sourceName); const sourceSales = new SalesRepository(sourceName)
  const category = await source.saveCategory({ id: crypto.randomUUID(), name: 'Laminas', order: 3, isActive: true })
  const category2 = await source.saveCategory({ id: crypto.randomUUID(), name: 'Regalos', order: 4, isActive: false })
  const first = await source.createProduct({ ...productInput(), categoryIds: [category.id], image: new Blob(['foto'], { type: 'image/png' }) })
  const sale = await sourceSales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: first.id, quantity: 1, unitPrice: first.price, expectedRevision: first.revision }], payments: [{ method: 'cash', amount: first.price }] })
  const product = (await source.snapshot()).products[0]
  const archived = { ...product, id: crypto.randomUUID(), name: 'Archivado', isArchived: true, activeName: undefined, categoryIds: [category2.id] }
  const sourceDb = await openCatalogDatabase(sourceName)
  const movements = await sourceDb.getAll('movements'); const costChanges = await sourceDb.getAll('costChanges'); const payments = await sourceDb.getAll('payments'); const metadata = await sourceDb.getAll('metadata')
  sourceDb.close(); await source.close(); await sourceSales.close()
  const name = databaseName()
  const old = await openDB<CatalogSchema>(name, 3, { upgrade(db) {
    db.createObjectStore('products', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
    db.createObjectStore('categories', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
    db.createObjectStore('movements', { keyPath: 'id' }).createIndex('by-product', 'productId')
    db.createObjectStore('costChanges', { keyPath: 'id' }).createIndex('by-product', 'productId')
    const sales = db.createObjectStore('sales', { keyPath: 'id' }); sales.createIndex('by-operation', 'operationId', { unique: true }); sales.createIndex('by-number', 'number', { unique: true }); sales.createIndex('by-date', 'soldAt')
    db.createObjectStore('payments', { keyPath: 'id' }).createIndex('by-sale', 'saleId')
    db.createObjectStore('metadata', { keyPath: 'key' }); db.createObjectStore('events', { keyPath: 'id' })
  } })
  const legacy = { ...product }; delete legacy.familyIds; delete legacy.ipIds; delete legacy.categoryId; delete legacy.classificationPending
  const legacyArchived = { ...archived }; delete legacyArchived.familyIds; delete legacyArchived.ipIds; delete legacyArchived.categoryId; delete legacyArchived.classificationPending
  await old.put('products', legacy); await old.put('products', legacyArchived); await old.put('categories', category); await old.put('categories', category2); await old.put('sales', sale)
  for (const item of movements) await old.put('movements', item)
  for (const item of costChanges) await old.put('costChanges', item)
  for (const item of payments) await old.put('payments', item)
  for (const item of metadata) await old.put('metadata', item)
  old.close()
  const originalPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'families') throw new DOMException('Cuota', 'QuotaExceededError')
    return originalPut.call(this, value, key)
  }
  try { await assert.rejects(openCatalogDatabase(name)) } finally { IDBObjectStore.prototype.put = originalPut }
  const unchanged = await openDB<CatalogSchema>(name, 3)
  assert.equal(unchanged.version, 3); assert.equal(unchanged.objectStoreNames.contains('families'), false)
  assert.deepEqual(await unchanged.get('products', product.id), legacy); unchanged.close()
  for (let i = 0; i < 3; i++) {
    const db = await openCatalogDatabase(name)
    assert.equal(db.version, CATALOG_DB_VERSION)
    assert.deepEqual(await db.get('products', product.id), { ...legacy, familyIds: [category.id], ipIds: [], categoryId: category.id, classificationPending: false })
    assert.deepEqual(await db.get('products', archived.id), { ...legacyArchived, familyIds: [category2.id], ipIds: [], categoryId: category2.id, classificationPending: false })
    assert.equal((await db.getAll('families')).length, 2); assert.equal((await db.getAll('ips')).length, 0)
    assert.deepEqual(await db.getAll('categories'), [category, category2].map(item => ({ ...item, normalizedName: item.name.toLocaleLowerCase('es-CL') })).sort((a,b) => a.id.localeCompare(b.id)))
    assert.deepEqual(await db.getAll('sales'), [sale]); assert.deepEqual(await db.getAll('movements'), movements); assert.deepEqual(await db.getAll('costChanges'), costChanges); assert.deepEqual(await db.getAll('payments'), payments)
    db.close()
  }
  const sales = new SalesRepository(name)
  const next = await sales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: product.id, quantity: 1, unitPrice: product.price, expectedRevision: product.revision }], payments: [{ method: 'transfer', amount: product.price }] })
  assert.equal(next.number, sale.number + 1); assert.equal(next.items[0].cost.unitCost, product.averageCost)
  await sales.close()
})
test('duplicados archivados heredados se conservan sin crear otros', async () => {
  const name = databaseName(); const catalog = new CatalogRepository(name); const repo = new ClassificationRepository(name)
  const a = await catalog.saveCategory({ id: crypto.randomUUID(), name: 'Igual', order: 0, isActive: true })
  const raw = await openCatalogDatabase(name)
  await raw.put('categories', { ...a, id: crypto.randomUUID(), name: ' igual ', isActive: false, activeName: undefined })
  raw.close()
  const db = await openCatalogDatabase(name)
  for (const category of (await catalog.snapshot()).categories) await db.put('families', { ...category, normalizedName: category.name.trim().toLocaleLowerCase('es-CL') })
  db.close()
  assert.equal((await repo.snapshot()).families.length, 2)
  await assert.rejects(repo.save('families', draft('IGUAL')))
  const first = (await repo.snapshot()).families.find(item => item.id === a.id)!
  await repo.save('families', { ...first, name: 'Nombre distinto', expectedUpdatedAt: first.updatedAt })
  await catalog.close()
})
