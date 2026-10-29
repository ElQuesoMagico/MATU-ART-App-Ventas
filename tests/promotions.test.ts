import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePromotionPricing, promotionPricingSignature, validatePromotion } from '../src/services/promotionRules.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase, CATALOG_DB_VERSION } from '../src/services/catalogDatabase.ts'
import { openDB } from 'idb'
import type { Promotion } from '../src/types/promotions.ts'
const id = () => crypto.randomUUID()
const productId = id(), categoryId = id(), familyId = id(), ipId = id()
const line = (overrides = {}) => ({ productId, quantity: 2, unitPrice: 1000, categoryId, familyIds: [familyId], ipIds: [ipId], ...overrides })
const promo = (overrides: Partial<Promotion> = {}): Promotion => ({ id: id(), name: 'Promocion', type: 'percentage', value: 10, productIds: [], categoryIds: [], familyIds: [], ipIds: [], minimumQuantity: 0, minimumAmount: 0, isActive: true, isArchived: false, isStackable: false, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', ...overrides })
const now = '2026-10-13T15:00:00Z'
for (const [label, promotion, expected] of [
  ['porcentaje producto', promo({ productIds: [productId] }), 1800],
  ['fijo categoria', promo({ type: 'fixed', value: 300, categoryIds: [categoryId] }), 1700],
  ['familia e IP', promo({ familyIds: [familyId], ipIds: [ipId] }), 1800],
  ['interseccion sin coincidencia', promo({ familyIds: [familyId], ipIds: [id()] }), 2000],
  ['cantidad minima', promo({ minimumQuantity: 3 }), 2000],
  ['importe minimo', promo({ minimumAmount: 2001 }), 2000],
  ['fecha futura', promo({ startDate: '2026-10-14' }), 2000],
  ['fecha vencida', promo({ endDate: '2026-10-12' }), 2000],
  ['fecha inclusiva', promo({ startDate: '2026-10-13', endDate: '2026-10-13' }), 1800],
  ['inactiva', promo({ isActive: false }), 2000],
  ['archivada', promo({ isArchived: true }), 2000],
] as const) test(label, () => assert.equal(calculatePromotionPricing([line()], [promotion], undefined, now).total, expected))
test('fechas se evalúan en Chile y minimos originales despues de manual no cambian elegibilidad', () => {
  const p = promo({ startDate: '2026-10-13', minimumAmount: 2000, minimumQuantity: 2 })
  assert.equal(calculatePromotionPricing([line()], [p], undefined, '2026-10-13T01:00:00Z').total, 2000)
  assert.equal(calculatePromotionPricing([line({ discount: { type: 'percentage', value: 50 } })], [p], undefined, now).total, 900)
})
test('acumulables, orden UUID, redondeo y mejor combinacion frente a una no acumulable', () => {
  const a = promo({ id: '00000000-0000-4000-8000-000000000001', value: 20, isStackable: true })
  const b = promo({ id: '00000000-0000-4000-8000-000000000002', value: 20, isStackable: true })
  const c = promo({ value: 30 })
  const result = calculatePromotionPricing([line()], [c,b,a], undefined, now)
  assert.equal(result.total, 1280); assert.deepEqual(result.promotions.map(p => p.id), [a.id,b.id])
  assert.deepEqual(calculatePromotionPricing([line()], [a,b,c], undefined, now), result)
  assert.equal(calculatePromotionPricing([line({ quantity: 1, unitPrice: 101 })], [promo({ value: 50 })], undefined, now).total, 50)
})
test('no acumulables disjuntas compatibles; solapadas gana mejor y desempate estable', () => {
  const another = id(); const a = promo({ productIds: [productId], value: 30 }); const b = promo({ productIds: [another], value: 50 })
  assert.equal(calculatePromotionPricing([line(),line({ productId: another })], [a,b], undefined, now).total, 2400)
  const c = promo({ productIds: [productId], value: 40 })
  assert.equal(calculatePromotionPricing([line()], [a,c], undefined, now).total, 1200)
  const d = { ...c, id: id() }
  const winner = [c,d].sort((x,y) => x.id.localeCompare(y.id))[0].id
  assert.equal(calculatePromotionPricing([line()], [d,c], undefined, now).promotions[0].id, winner)
})
test('descuentos manuales adicionales, fixed general reservado y total cero sin negativos', () => {
  const p = promo({ value: 50 })
  const result = calculatePromotionPricing([line({ discount: { type: 'fixed', value: 200 } })], [p], { type: 'percentage', value: 10 }, now)
  assert.equal(result.total, 810); assert.equal(result.discount, 1190)
  assert.equal(calculatePromotionPricing([line()], [promo({ value: 100 })], { type: 'fixed', value: 100 }, now).total, 1900)
  assert.equal(calculatePromotionPricing([line()], [promo({ type: 'fixed', value: 9999 })], undefined, now).total, 0)
})
test('cambiar cantidad o eliminar producto retira promocion y no muta entradas', () => {
  const p = promo({ minimumQuantity: 2 }); const lines = [line()]; const clone = structuredClone({ p, lines })
  assert.equal(calculatePromotionPricing(lines, [p], undefined, now).promotions.length, 1)
  assert.equal(calculatePromotionPricing([line({ quantity: 1 })], [p], undefined, now).promotions.length, 0)
  assert.equal(calculatePromotionPricing([], [p], undefined, now).promotions.length, 0)
  assert.deepEqual({ p, lines }, clone)
})
test('reparto entero proporcional suma exactamente y conserva configuracion', () => {
  const another = id(); const p = promo({ type: 'fixed', value: 101 })
  const result = calculatePromotionPricing([line({ quantity: 1, unitPrice: 100 }), line({ productId: another, quantity: 1, unitPrice: 100 })], [p], undefined, now)
  assert.equal(result.promotions[0].products.reduce((sum,b) => sum+b.amount,0),101)
  assert.deepEqual(result.promotions[0].configuration,p)
  assert.equal(result.lines.reduce((sum,l) => sum+l.promotionDiscount,0),101)
})
test('validaciones y limite explicito, sin descartar reglas silenciosamente', () => {
  for (const p of [promo({ value: 101 }), promo({ minimumAmount: -1 }), promo({ endDate: '2026-02-30' }), promo({ startDate: '2026-12-01', endDate: '2026-01-01' }), promo({ productIds: [productId,productId] })]) assert.throws(() => validatePromotion(p))
  assert.throws(() => calculatePromotionPricing([line()], Array.from({length:13}, () => promo()), undefined, now), /12/)
})
async function setup() {
  const name = `promotions-${id()}`, catalog = new CatalogRepository(name), sales = new SalesRepository(name), promotions = new PromotionRepository(name)
  const product = await catalog.createProduct({ id: id(), name: 'Print', categoryIds: [], price: 1000, initialStock: 7, initialCost: 200, lowStockThreshold: 1, isFavorite: false })
  return { name,catalog,sales,promotions,product }
}
test('persistencia, edicion, activar/desactivar, archivo y reactivacion', async () => {
  const { name,catalog,sales,promotions,product } = await setup()
  let p = await promotions.save(promo({ productIds: [product.id] }))
  p = await promotions.save({ ...p, name: 'Editada', isActive: false }, p.updatedAt)
  assert.deepEqual((await new PromotionRepository(name).snapshot())[0],p)
  p = await promotions.save({ ...p, isActive: true }, p.updatedAt)
  p = await promotions.save({ ...p, isArchived: true }, p.updatedAt); assert.equal(p.isActive,false)
  p = await promotions.save({ ...p, isArchived: false, isActive: true }, p.updatedAt)
  await assert.rejects(promotions.save({ ...p, productIds: [id()] },p.updatedAt))
  await catalog.close(); await sales.close()
})
test('limite de activacion concurrente seguro', async () => {
  const repo = new PromotionRepository(`limit-${id()}`)
  for (let i=0;i<11;i++) await repo.save(promo({name:`Promoción ${i}`}))
  const results = await Promise.allSettled([repo.save(promo({name: "Límite A"})),repo.save(promo({name: "Límite B"}))])
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1)
  assert.equal((await repo.snapshot()).filter(p => p.isActive).length,12)
})
test('venta historica, pagos divididos, reintento, configuracion editada y anulacion', async () => {
  const { name,catalog,sales,promotions,product } = await setup()
  const p = await promotions.save(promo({ productIds: [product.id], value: 20 }))
  const item = { productId: product.id, quantity: 2, unitPrice: product.price, expectedRevision: product.revision, discount: { type: 'fixed', value: 200 } as const }
  const pricing = calculatePromotionPricing([{ ...item, categoryId: product.categoryId }], [p], { type: 'fixed', value: 40 }, new Date().toISOString())
  const request = { operationId:id(), items:[item], generalDiscount: { type:'fixed', value:40 } as const, pricingSignature: promotionPricingSignature(pricing), payments:[{ method:'cash',amount:700 },{ method:'debit',amount:700 }] as const }
  const input = { ...request, payments:[...request.payments] }
  const [sale,retry] = await Promise.all([sales.confirm(input),sales.confirm(input)])
  assert.deepEqual(sale,retry); assert.equal(sale.total,1400); assert.equal(sale.discount,600)
  assert.equal(sale.appliedPromotions?.[0].amount,360); assert.equal(sale.items[0].promotionDiscount,360)
  assert.equal((await catalog.snapshot()).products[0].stock,5)
  await promotions.save({ ...p, name:'Cambio posterior', value:90, isArchived:true },p.updatedAt)
  await sales.close(); const reopened = new SalesRepository(name)
  assert.deepEqual((await reopened.snapshot()).sales[0],sale)
  const voided = await reopened.voidSale({ saleId:sale.id,operationId:id(),reason:'Prueba',returnStock:true })
  assert.deepEqual(voided.appliedPromotions,sale.appliedPromotions); assert.deepEqual(voided.payments,sale.payments); assert.equal((await catalog.snapshot()).products[0].stock,7)
  await catalog.close(); await reopened.close()
})
test('cambios de promociones durante pago rechazan sin escrituras parciales', async () => {
  const { catalog,sales,promotions,product } = await setup(); const p = await promotions.save(promo())
  const line = { productId:product.id,quantity:1,unitPrice:product.price,expectedRevision:product.revision }
  const pricing = calculatePromotionPricing([{...line,categoryId:product.categoryId}], [p], undefined, new Date().toISOString())
  await promotions.save({...p,value:20},p.updatedAt)
  await assert.rejects(sales.confirm({operationId:id(),items:[line],pricingSignature:promotionPricingSignature(pricing),payments:[{method:'cash',amount:900}]}),/promociones cambiaron/)
  assert.equal((await sales.snapshot()).sales.length,0); assert.equal((await catalog.snapshot()).products[0].stock,7)
  await catalog.close(); await sales.close()
})
test('100 por ciento sin red y pagos vacios', async () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Sin red') }
  try { const { catalog,sales,promotions,product } = await setup(); await promotions.save(promo({value:100})); const sale = await sales.confirm({operationId:id(),items:[{productId:product.id,quantity:1,unitPrice:product.price,expectedRevision:product.revision}],payments:[]}); assert.equal(sale.total,0); assert.deepEqual(sale.payments,[]); await catalog.close(); await sales.close() } finally { globalThis.fetch=originalFetch }
})
test('migracion v5 a v6 agrega almacen sin reescribir productos o ventas anteriores', async () => {
  const { name,catalog,sales,product }= await setup()
  const sale=await sales.confirm({operationId:id(),items:[{productId:product.id,quantity:1,unitPrice:product.price,expectedRevision:product.revision}],payments:[{method:'cash',amount:1000}]})
  const current=(await catalog.snapshot()).products[0]; await catalog.close(); await sales.close()
  const oldName=`legacy5-${id()}`
  const old=await openDB(oldName,5,{upgrade(db){db.createObjectStore('products',{keyPath:'id'}); db.createObjectStore('sales',{keyPath:'id'})}})
  const legacy=structuredClone(sale); delete legacy.appliedPromotions; delete legacy.items[0].promotionDiscount
  await old.put('products',current); await old.put('sales',legacy); old.close()
  const upgraded=await openCatalogDatabase(oldName)
  assert.equal(upgraded.version,CATALOG_DB_VERSION); assert.deepEqual(await upgraded.getAll('promotions'),[])
  assert.deepEqual(await upgraded.get('products',product.id),current); assert.deepEqual(await upgraded.get('sales',legacy.id),legacy); upgraded.close()
  const db=await openCatalogDatabase(name); db.close()
})

test('maximo soportado explora combinaciones exactas y no comparte referencias historicas', () => {
  const rules=Array.from({length:12},()=>promo({isStackable:true,value:10}))
  const pricing=calculatePromotionPricing([line({quantity:1})],rules,undefined,now)
  assert.equal(pricing.total,282); assert.equal(pricing.promotions.length,12)
  const originalName=rules.find(p=>p.id===pricing.promotions[0].id)!.name
  pricing.promotions[0].configuration.name='Cambio en la copia'
  assert.equal(rules.find(p=>p.id===pricing.promotions[0].id)!.name,originalName)
})
