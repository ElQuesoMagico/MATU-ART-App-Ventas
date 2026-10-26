import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePromotionPricing, promotionPricingSignature, validatePromotion } from '../src/services/promotionRules.ts'
import { productFormErrors, initialProductCosts } from '../src/services/productFormRules.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import type { Promotion } from '../src/types/promotions.ts'
const id = () => crypto.randomUUID(), eventId = id(), productId = id(), categoryId = id(), familyId = id(), ipId = id()
const now = '2026-10-13T15:00:00Z'
const promo = (patch: Partial<Promotion> = {}): Promotion => ({ id: id(), name: '2 stickers por $1.000', type: 'quantity', groupQuantity: 2, value: 1000, productIds: [], categoryIds: [categoryId], familyIds: [], ipIds: [], minimumQuantity: 0, minimumAmount: 0, isActive: true, isArchived: false, isStackable: false, createdAt: now, updatedAt: now, ...patch })
const line = (quantity = 5) => ({ productId, categoryId, familyIds: [familyId], ipIds: [ipId], quantity, unitPrice: 800 })
test('cantidad: 5 unidades forman dos grupos de dos y una suelta; sin mutaciones', () => {
 const lines = [line()], p = promo(), before = structuredClone(lines), result = calculatePromotionPricing(lines, [p], undefined, now)
 assert.equal(result.total, 2800); assert.equal(result.combos[0].applications, 2); assert.equal(result.combos[0].products[0].quantity, 4); assert.deepEqual(result.combos[0].configuration,p); assert.deepEqual(lines,before)
 assert.equal(calculatePromotionPricing([line(1)], [p], undefined, now).total,800)
})
test('cantidad: intersección producto/categoría/familia/IP y mínimos', () => {
 const p = promo({ productIds:[productId], familyIds:[familyId], ipIds:[ipId], minimumQuantity:5, minimumAmount:4000 })
 assert.equal(calculatePromotionPricing([line()], [p], undefined, now).total,2800)
 for(const patch of [{ipIds:[id()]},{familyIds:[]},{categoryId:id()},{productId:id()}]) assert.equal(calculatePromotionPricing([{...line(),...patch}], [p], undefined, now).total,4000)
 assert.equal(calculatePromotionPricing([line(4)], [p], undefined, now).total,3200)
})
test('evento: porcentual, fijo, cantidad y combo solo aplican a UUID autorizado', () => {
 for(const type of ['percentage','fixed','quantity','combo'] as const) {
  const p = promo({ type, value:type==='percentage'?10:100, eventIds:[eventId,id()], ...(type==='combo'?{categoryIds:[],components:[{id:id(),kind:'product',targetId:productId,quantity:2}]}:{}) })
  for(const active of [undefined,id()]) assert.equal(calculatePromotionPricing([line()], [p], undefined,now,active).total,4000)
  assert.ok(calculatePromotionPricing([line()], [p], undefined,now,eventId).total<4000)
 }
})
test('excepción heredada tiene prioridad y evita descuento duplicado por evento', () => {
 const lines = [{...line(),hasEventPrice:true,unitPrice:500}]
 for(const type of ['fixed','percentage','quantity','combo'] as const) {
  const p=promo({type,eventIds:[eventId],value:10,...(type==='combo'?{categoryIds:[],components:[{id:id(),kind:'product',targetId:productId,quantity:2}]}:{})})
  assert.equal(calculatePromotionPricing(lines,[p],undefined,now,eventId).total,2500)
 }
 // Promociones generales mantienen su compatibilidad preexistente.
 assert.equal(calculatePromotionPricing(lines,[promo({type:'percentage',value:10})],undefined,now,eventId).total,2250)
})
test('cantidad: competencia exacta, manuales, acumulación y cero', () => {
 const group=promo({isStackable:true}), percent=promo({type:'percentage',value:10,isStackable:true})
 const lines=[{...line(),discount:{type:'fixed' as const,value:100}}]
 assert.equal(calculatePromotionPricing(lines,[group,percent],{type:'percentage',value:10},now).total,2252)
 const competing=promo({type:'percentage',value:50})
 assert.equal(calculatePromotionPricing([line()],[group,competing],undefined,now).total,2000)
 assert.equal(calculatePromotionPricing([line(4)],[promo({value:0})],undefined,now).total,0)
 const combo=promo({type:'combo',value:900,categoryIds:[],components:[{id:id(),kind:'product',targetId:productId,quantity:2}]})
 assert.equal(calculatePromotionPricing([line()],[group,combo],undefined,now).total,2600)
})
test('cantidad: límites explícitos y validación de eventos/grupos', () => {
 for(const groupQuantity of [0,1,2.5,9,undefined]) assert.throws(()=>validatePromotion(promo({groupQuantity})))
 for(const eventIds of [[eventId,eventId],['mal']]) assert.throws(()=>validatePromotion(promo({eventIds})))
 assert.throws(()=>calculatePromotionPricing([line(25)],[promo()],undefined,now),/24 unidades/)
 assert.equal(calculatePromotionPricing([line()],[promo({startDate:'2026-10-14'})],undefined,now).total,4000)
})
test('formulario: campos obligatorios, CLP, costo desconocido y cero', () => {
 const values={name:'Sticker',categoryId,price:'800',cost:'0',stock:'5',threshold:'1'}
 assert.deepEqual(productFormErrors(values,[]),{});assert.deepEqual(initialProductCosts(''),{initialCost:undefined,estimatedUnitCost:undefined});assert.deepEqual(initialProductCosts('0'),{initialCost:0,estimatedUnitCost:0})
 assert.ok(productFormErrors({...values,name:' ',categoryId:'',price:'1.5',cost:'-1',stock:'abc',threshold:''},[]).name)
 assert.equal(Object.keys(productFormErrors({...values,name:' ',categoryId:'',price:'1.5',cost:'-1',stock:'abc',threshold:''},[])).length,6)
})
test('persistencia: costo único, promoción por evento, venta, historial y anulación', async () => {
 const name=`simplify-${id()}`, catalog=new CatalogRepository(name), events=new EventRepository(name), promos=new PromotionRepository(name), sales=new SalesRepository(name)
 const event=await events.save(id(),{name:'Feria',startDate:'2026-10-13',endDate:'2026-10-13'});await events.activate(event.id,event.updatedAt)
 const product=await catalog.createProduct({id:id(),name:'Sticker',categoryIds:[],price:800,initialStock:10,lowStockThreshold:1,isFavorite:false,...initialProductCosts('200')})
 assert.equal(product.averageCost,200);assert.equal(product.lastKnownCost,200);assert.equal(product.estimatedUnitCost,200)
 const saved=await promos.save(promo({categoryIds:[],productIds:[product.id],eventIds:[event.id]}))
 const pricing=calculatePromotionPricing([{productId:product.id,unitPrice:800,quantity:5}], [saved], undefined, new Date().toISOString(),event.id)
 const sale=await sales.confirm({operationId:id(),items:[{productId:product.id,unitPrice:800,quantity:5,expectedRevision:product.revision}],payments:[{method:'cash',amount:1000},{method:'transfer',amount:1800}],pricingSignature:promotionPricingSignature(pricing)})
 assert.equal(sale.total,2800);assert.equal(sale.appliedCombos?.[0].configuration.eventIds?.[0],event.id)
 const current=(await catalog.snapshot()).products[0]
 await catalog.updateProduct(product.id,{...current,estimatedUnitCost:350},current.revision,'Nuevo costo')
 assert.equal((await catalog.snapshot()).products[0].averageCost,200);assert.equal((await catalog.snapshot()).products[0].lastKnownCost,200)
 await promos.save({...saved,value:500},saved.updatedAt)
 await catalog.close();await sales.close()
 assert.deepEqual((await sales.snapshot()).sales[0],sale)
 const db=await openCatalogDatabase(name);assert.equal(db.version, 10);db.close()
 const reopened=(await promos.snapshot())[0];assert.deepEqual(reopened.eventIds,[event.id])
 await sales.voidSale({operationId:id(),saleId:sale.id,reason:'Prueba',returnStock:true})
 assert.equal((await catalog.snapshot()).products[0].stock,10)
 assert.deepEqual((await sales.snapshot()).sales[0].appliedCombos,sale.appliedCombos)
 await catalog.close();await sales.close()
})
test('eventos inexistentes se rechazan sin guardar la promoción', async()=>{
 const repository=new PromotionRepository(`invalid-event-${id()}`)
 await assert.rejects(repository.save(promo({categoryIds:[],eventIds:[id()]})),/evento/)
 assert.equal((await repository.snapshot()).length,0)
})
