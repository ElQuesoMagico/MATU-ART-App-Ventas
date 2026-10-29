import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EntityAdministration, reviewDeletion, entityKinds } from '../src/services/entityAdministration.ts'
import { CatalogRepository } from '../src/services/catalogRepository.ts'
import { ClassificationRepository } from '../src/services/classificationRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { emptySnapshot, readData } from '../src/services/data/snapshot.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { calculatePromotionPricing, promotionPricingSignature } from '../src/services/promotionRules.ts'
import type { Promotion } from '../src/types/promotions.ts'
const item = (name: string) => ({ id: crypto.randomUUID(), name, order: 0, isActive: true })
async function setup() {
  const name = `admin-${crypto.randomUUID()}`, repo = new ClassificationRepository(name), products = new CatalogRepository(name), admin = new EntityAdministration(name)
  const category = await repo.save('categories', item('Sticker'))
  const product = await products.createProduct({ id: crypto.randomUUID(), name: 'Prueba', categoryId: category.id, categoryIds: [category.id], price: 600, initialStock: 0, lowStockThreshold: 0, isFavorite: false })
  return { name, repo, products, admin, category, product }
}
test('menú ofrece los cinco tipos; eliminación confirmada persiste sin migración', async () => {
  assert.deepEqual(entityKinds, ['products','categories','families','ips','promotions'])
  const f = await setup(), review = await f.admin.review('products', f.product.id)
  assert.equal(review.allowed, true)
  await assert.rejects(f.admin.remove(review, 'otro'), /nombre exacto/)
  await f.admin.remove(review, f.product.name)
  await assert.rejects(f.admin.remove(review, f.product.name), /ya no existe/)
  await f.products.close()
  const db = await openCatalogDatabase(f.name); assert.equal(db.version, 10); assert.equal(await db.count('products'), 0); assert.equal(await db.count('categories'), 1); db.close()
})
test('categoría utilizada bloquea eliminación; reasignación previa conserva UUID, costos, stock y familias', async () => {
  const f = await setup(), target = await f.repo.save('categories', item('Print'))
  assert.equal((await f.admin.review('categories', f.category.id)).allowed, false)
  const plan = await f.admin.previewCategory(f.category.id, target.id)
  await f.admin.reassignCategory(f.category.id, target.id, plan.token)
  const next = (await readData(f.name)).products[0]
  assert.deepEqual(next, { ...f.product, categoryId: target.id, categoryIds: [target.id], updatedAt: next.updatedAt, revision: 2 })
  assert.equal((await f.admin.review('categories', f.category.id)).allowed, true)
  await f.products.close()
})
test('vista previa obsoleta no permite reasignaciones ni borrados parciales', async () => {
  const f = await setup(), target = await f.repo.save('categories', item('Print'))
  const plan = await f.admin.previewCategory(f.category.id, target.id), review = await f.admin.review('products', f.product.id)
  await f.products.updateProduct(f.product.id, { ...f.product, price: 700 }, f.product.revision)
  await assert.rejects(f.admin.reassignCategory(f.category.id, target.id, plan.token), /nueva vista previa/)
  await assert.rejects(f.admin.remove(review, f.product.name), /registro cambió/)
  assert.equal((await readData(f.name)).products[0].categoryId, f.category.id)
  await f.products.close()
})
test('dependencias nuevas se comprueban al borrar dentro de transacción', async () => {
  const f = await setup(), review = await f.admin.review('products', f.product.id)
  const db = await openCatalogDatabase(f.name)
  await db.put('importRecords', { id:crypto.randomUUID(),sourceKey:'test',sourceHash:'hash',sourceName:'test.csv',kind:'catalog',row:2,targetId:f.product.id,batchId:crypto.randomUUID(),createdAt:new Date().toISOString(),original:{} })
  await assert.rejects(f.admin.remove(review, f.product.name), /importRecords/)
  assert.equal(await db.count('products'),1); assert.equal(await db.count('importRecords'),1); db.close(); await f.products.close()
})
test('stock, costo cero, movimientos, promociones, metadatos y snapshots históricos bloquean borrado', async () => {
  const f = await setup(), data = await readData(f.name)
  for (const patch of [{stock:1}, {averageCost:0}, {lastKnownCost:0}, {estimatedUnitCost:0}, {eventPrices:[{eventId:crypto.randomUUID(),price:0}]}]) {
    const copy=structuredClone(data); Object.assign(copy.products[0],patch); assert.equal(reviewDeletion(copy,'products',f.product.id).allowed,false)
  }
  data.metadata.push({key:'pending-sync',value:1})
  assert.equal(reviewDeletion(data,'products',f.product.id).allowed,false)
  const db=await openCatalogDatabase(f.name)
  await db.put('movements',{id:crypto.randomUUID(),productId:f.product.id,type:'adjustment',quantityChange:0,previousStock:0,resultingStock:0,createdAt:new Date().toISOString(),requestedQuantity:0})
  assert.match((await f.admin.review('products',f.product.id)).blockers.join(' '),/movements/)
  db.close(); await f.products.close()
})
test('familias/IPs sin relaciones se eliminan; UUID históricos compartidos no son dependencia por sí solos', async () => {
  const f=await setup()
  for(const kind of ['families','ips'] as const) {
    const value=await f.repo.save(kind,item(kind))
    await f.admin.remove(await f.admin.review(kind,value.id),value.name)
    assert.equal((await readData(f.name))[kind].length,0)
  }
  const data=emptySnapshot(), id=crypto.randomUUID(), now=new Date().toISOString()
  data.families.push({...item('Familia'),id,createdAt:now,updatedAt:now})
  data.categories.push({...item('Categoría'),id,createdAt:now,updatedAt:now})
  assert.equal(reviewDeletion(data,'families',id).allowed,true)
  await f.products.close()
})
test('promoción sin uso se elimina; duplicados se rechazan y ventas conservan promoción utilizada', async () => {
  const f=await setup(), repo=new PromotionRepository(f.name), sales=new SalesRepository(f.name)
  const draft:Promotion={id:crypto.randomUUID(),name:'Beneficio QA',type:'percentage',value:10,productIds:[f.product.id],categoryIds:[],familyIds:[],ipIds:[],minimumQuantity:0,minimumAmount:0,isActive:true,isArchived:false,isStackable:false,createdAt:'',updatedAt:''}
  const promotion=await repo.save(draft)
  await assert.rejects(repo.save({...draft,id:crypto.randomUUID(),name:' beneficio qa '}),/Ya existe/)
  assert.equal((await f.admin.review('promotions',promotion.id)).allowed,true)
  assert.equal((await f.admin.review('products',f.product.id)).allowed,false)
  const line={productId:f.product.id,quantity:1,unitPrice:f.product.price,expectedRevision:f.product.revision,categoryId:f.category.id,familyIds:[],ipIds:[]}
  const pricing=calculatePromotionPricing([line],[promotion],undefined,new Date().toISOString())
  await sales.confirm({operationId:crypto.randomUUID(),items:[line],payments:[{method:'cash',amount:pricing.total}],pricingSignature:promotionPricingSignature(pricing)})
  const before=await readData(f.name)
  assert.equal((await f.admin.review('promotions',promotion.id)).allowed,false)
  await assert.rejects(f.admin.remove(await f.admin.review('products',f.product.id),f.product.name),/No se puede eliminar/)
  assert.deepEqual((await readData(f.name)).sales,before.sales)
  assert.deepEqual((await readData(f.name)).movements,before.movements)
  const unused=await repo.save({...draft,id:crypto.randomUUID(),name:'Sin uso',isActive:false})
  await f.admin.remove(await f.admin.review('promotions',unused.id),unused.name)
  await sales.close(); await f.products.close()
})
test('fallo en segunda escritura revierte toda la reasignación', async () => {
  const f=await setup(), target=await f.repo.save('categories',item('Destino'))
  await f.products.createProduct({id:crypto.randomUUID(),name:'Segundo',categoryId:f.category.id,categoryIds:[f.category.id],price:1,initialStock:0,lowStockThreshold:0,isFavorite:false})
  const before=await readData(f.name), plan=await f.admin.previewCategory(f.category.id,target.id)
  const original=IDBObjectStore.prototype.put
  let writes=0
  IDBObjectStore.prototype.put=function(...args:Parameters<typeof original>) {
    if(this.name==='products' && ++writes===2) throw new Error('Fallo inyectado')
    return original.apply(this,args)
  }
  try { await assert.rejects(f.admin.reassignCategory(f.category.id,target.id,plan.token),/Fallo inyectado/) }
  finally { IDBObjectStore.prototype.put=original }
  assert.deepEqual((await readData(f.name)).products,before.products)
  await f.products.close()
})

