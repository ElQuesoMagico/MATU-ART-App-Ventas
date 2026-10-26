import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CatalogRepository } from '../src/services/catalogRepository.ts'
import { ClassificationRepository } from '../src/services/classificationRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { matchesClassifications } from '../src/services/catalogClassification.ts'
import { openDB } from 'idb'
const databaseName = () => `classification45-${crypto.randomUUID()}`
const fields = () => ({ id: crypto.randomUUID(), name: 'Producto', categoryIds: [], familyIds: [], ipIds: [], price: 1000, initialStock: 7, initialCost: 200, lowStockThreshold: 1, isFavorite: false })
const item = (name: string) => ({ id: crypto.randomUUID(), name, description: 'Descripcion', order: 0, isActive: true })
test('categoria obligatoria y tres tipos independientes, archivo y reactivacion', async () => {
  const name = databaseName(); const catalog = new CatalogRepository(name); const repo = new ClassificationRepository(name)
  await assert.rejects(catalog.createProduct(fields()), /categoría principal/)
  const category = await repo.save('categories', item('Print'))
  const family = await repo.save('families', item('Print')); const ip = await repo.save('ips', item('Print'))
  await assert.rejects(repo.save('categories', item(' print ')), /Ya existe/)
  let product = await catalog.createProduct({ ...fields(), categoryId: category.id, familyIds: [family.id], ipIds: [ip.id] })
  const originalMovements = await catalog.movementsFor(product.id)
  let edited = await repo.save('categories', { ...category, name: 'Lamina', description: 'Papel', order: 2, expectedUpdatedAt: category.updatedAt })
  edited = await repo.save('categories', { ...edited, isActive: false, expectedUpdatedAt: edited.updatedAt })
  product = await catalog.updateProduct(product.id, { ...product, name: 'Nombre nuevo' }, product.revision)
  await assert.rejects(catalog.createProduct({ ...fields(), categoryId: category.id }))
  await assert.rejects(catalog.updateProduct(product.id, { ...product, categoryId: '' }, product.revision))
  edited = await repo.save('categories', { ...edited, isActive: true, expectedUpdatedAt: edited.updatedAt })
  assert.equal(edited.id, category.id)
  assert.equal(matchesClassifications(product, [family.id], [ip.id], [category.id]), true)
  assert.equal(matchesClassifications(product, [family.id], [ip.id], [crypto.randomUUID()]), false)
  assert.deepEqual(await catalog.movementsFor(product.id), originalMovements)
  assert.equal(product.stock, 7); assert.equal(product.averageCost, 200)
  await catalog.close(); assert.equal((await new CatalogRepository(name).snapshot()).products[0].categoryId, category.id)
})
test('migracion v4 recupera por UUID, conserva familias posteriores y marca ambiguedad sin inferir nombres', async () => {
  const name = databaseName(); const source = new CatalogRepository(name); const repo = new ClassificationRepository(name)
  const category = await repo.save('categories', item('Sticker'))
  const original = await source.createProduct({ ...fields(), categoryId: category.id })
  const db = await openCatalogDatabase(name); const dump = await db.get('products', original.id); db.close(); await source.close()
  // Construir base anterior sin campos de Etapa 4.5.
  const oldName = databaseName()
  const old = await openDB(oldName, 4, { upgrade(db) {
    for (const name of ['products', 'categories', 'families', 'ips', 'movements', 'costChanges', 'sales', 'payments', 'metadata', 'events']) {
      const store = db.createObjectStore(name, { keyPath: name === 'metadata' ? 'key' : 'id' })
      if (['products','categories'].includes(name)) store.createIndex('active-name', 'activeName', { unique: true })
      if (['families','ips'].includes(name)) store.createIndex('by-name', 'normalizedName')
      if (['movements','costChanges'].includes(name)) store.createIndex('by-product', 'productId')
      if (name === 'sales') { store.createIndex('by-operation', 'operationId', { unique: true }); store.createIndex('by-number', 'number', { unique: true }); store.createIndex('by-date', 'soldAt') }
      if (name === 'payments') store.createIndex('by-sale', 'saleId')
    }
  } })
  const legacy = { ...dump!, categoryIds: [], familyIds: [category.id], ipIds: [] }; delete legacy.categoryId; delete legacy.classificationPending
  const category2 = item('Libreta')
  const ambiguous = { ...legacy, id: crypto.randomUUID(), name: 'Ambiguo', activeName: 'ambiguo', familyIds: [category.id, category2.id] }
  const newer = item('Sticker') // mismo nombre, distinto ID: no categoría verificable
  const pending = { ...legacy, id: crypto.randomUUID(), name: 'Pendiente', activeName: 'pendiente', familyIds: [newer.id] }
  await old.put('categories', category); await old.put('categories', category2)
  await old.put('families', category2); await old.put('products', ambiguous)
  await old.put('families', category); await old.put('families', newer)
  await old.put('products', legacy); await old.put('products', pending)
  old.close()
  for (let i=0;i<2;i++) {
    const db = await openCatalogDatabase(oldName)
    assert.equal(db.version, 10)
    assert.deepEqual(await db.get('products', legacy.id), { ...legacy, categoryId: category.id, classificationPending: false })
    assert.deepEqual(await db.get('products', pending.id), { ...pending, categoryId: undefined, classificationPending: true })
    assert.deepEqual(await db.get('products', ambiguous.id), { ...ambiguous, categoryId: undefined, classificationPending: true })
    assert.equal((await db.getAll('categories')).length, 2); assert.equal((await db.getAll('families')).length, 3)
    db.close()
  }
  const catalog = new CatalogRepository(oldName); const products = (await catalog.snapshot()).products
  const migrated = products.find(p => p.id === legacy.id)!
  const unresolved = products.find(p => p.id === pending.id)!
  await assert.rejects(catalog.updateProduct(unresolved.id, { ...unresolved, name: 'Pendiente editado' }, unresolved.revision))
  await catalog.updateProduct(unresolved.id, { ...unresolved, categoryId: category.id }, unresolved.revision)
  const sales = new SalesRepository(oldName)
  const sale = await sales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: migrated.id, quantity: 1, unitPrice: migrated.price, expectedRevision: migrated.revision }], payments: [{ method: 'cash', amount: migrated.price }] })
  assert.equal(sale.total, 1000); assert.equal(sale.items[0].cost.unitCost, 200)
  await catalog.close(); await sales.close()
})
