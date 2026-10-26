import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { calculatePromotionPricing, promotionPricingSignature, validatePromotion } from '../src/services/promotionRules.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import type { Promotion } from '../src/types/promotions.ts'
const id = () => crypto.randomUUID()
const poster=id(), sticker=id(), other=id(), category=id()
const now='2026-10-13T15:00:00Z'
const line=(productId=poster, quantity=1, unitPrice=5000) => ({productId,quantity,unitPrice,categoryId:category})
const cart=()=>[line(),line(sticker,2,1500)]
const promo=(fields:Partial<Promotion>={}):Promotion=>({id:id(),name:'Combo',type:'combo',value:7500,components:[{id:id(),kind:'product',targetId:poster,quantity:1},{id:id(),kind:'product',targetId:sticker,quantity:2}],productIds:[],categoryIds:[],familyIds:[],ipIds:[],minimumQuantity:0,minimumAmount:0,isActive:true,isArchived:false,isStackable:false,createdAt:now,updatedAt:now,...fields})
const price=(lines=cart(),promotions=[promo()])=>calculatePromotionPricing(lines,promotions,undefined,now)
test('combo completo: conserva líneas y distribuye ahorro exacto',()=>{
  const p=promo(), result=price(cart(),[p])
  assert.equal(result.total,7500);assert.equal(result.combos[0].amount,500);assert.equal(result.lines.length,2)
  assert.equal(result.combos[0].products.reduce((s,p)=>s+p.amount,0),500)
  assert.equal(result.combos[0].originalAmount,8000);assert.deepEqual(result.combos[0].configuration,p)
  assert.equal(result.lines.reduce((s,l)=>s+l.netAmount,0),7500)
})
test('incompleto, sin ahorro, inactivo o fuera de fecha no aplica',()=>{
  assert.equal(price([line(),line(sticker,1,1500)]).combos.length,0)
  for(const fields of [{value:8000},{value:9000},{isActive:false},{startDate:'2026-10-14'},{endDate:'2026-10-12'}]) assert.equal(price(cart(),[promo(fields)]).total,8000)
})
test('múltiples aplicaciones y unidades sobrantes',()=>{
  const result=price([line(poster,2),line(sticker,5,1500)])
  assert.equal(result.total,16500);assert.equal(result.combos[0].applications,2)
  assert.equal(result.combos[0].products.find(p=>p.productId===sticker)?.quantity,4)
})
test('categoría acepta distintos productos y elige los de mayor ahorro',()=>{
  const p=promo({value:2000,components:[{id:id(),kind:'category',targetId:category,quantity:2}]})
  const result=price([line(poster,1,3000),line(sticker,1,1000),line(other,1,2000)],[p])
  assert.equal(result.total,3000);assert.deepEqual(new Set(result.combos[0].products.map(p=>p.productId)),new Set([poster,other]))
})
test('combos competidores: optimización conjunta supera elección codiciosa',()=>{
  const a=promo({value:5000,components:[{id:id(),kind:'product',targetId:poster,quantity:1},{id:id(),kind:'product',targetId:sticker,quantity:1}]})
  const b=promo({value:2000,components:[{id:id(),kind:'product',targetId:poster,quantity:1},{id:id(),kind:'product',targetId:other,quantity:1}]})
  const c=promo({value:0,components:[{id:id(),kind:'product',targetId:sticker,quantity:1}]})
  const result=price([line(),line(sticker,1,1500),line(other,1,1000)],[a,b,c])
  assert.equal(result.total,2000);assert.deepEqual(new Set(result.combos.map(p=>p.id)),new Set([b.id,c.id]))
})
test('promoción compatible e incompatible se evalúan con los combos',()=>{
  const c=promo({isStackable:true}), p=promo({type:'percentage',value:10,components:undefined,isStackable:true})
  assert.equal(price(cart(),[c,p]).total,6750)
  assert.equal(price(cart(),[{...c,isStackable:false},p]).total,7200)
  const result=price([line(),line(sticker,3,1500)],[promo({value:6000}),{...p,productIds:[sticker],value:50,isStackable:false}])
  assert.equal(result.total,6750);assert.equal(result.promotions[0].products[0].quantity,1)
})
test('manual por línea reduce ahorro necesario para llegar al precio del combo',()=>{
  const lines=cart().map(l=>l.productId===poster?{...l,discount:{type:'fixed' as const,value:200}}:l)
  const result=price(lines)
  assert.equal(result.total,7500);assert.equal(result.combos[0].amount,300);assert.equal(result.discount,500)
  assert.equal(price(cart().map(l=>({...l,discount:{type:'percentage' as const,value:50}}))).combos.length,0)
})
test('manual general, total cero y redondeo mitad hacia arriba',()=>{
  const result=calculatePromotionPricing(cart(),[promo()],{type:'percentage',value:10},now)
  assert.equal(result.total,6750)
  assert.equal(calculatePromotionPricing(cart(),[promo()],{type:'percentage',value:100},now).total,0)
  assert.equal(price(cart(),[promo({value:0})]).total,0)
  const c=promo({value:101,isStackable:true,components:[{id:id(),kind:'product',targetId:poster,quantity:1}]})
  const p=promo({type:'percentage',value:50,components:undefined,isStackable:true})
  assert.equal(price([line(poster,1,200)],[c,p]).total,50)
})
test('cambio de cantidad retira combo, no muta ni duplica consumo y es determinista',()=>{
  const c=promo({isStackable:true}), d=promo({isStackable:true}), lines=cart(), before=structuredClone(lines)
  const result=price(lines,[c,d]);assert.equal(result.combos.reduce((s,c)=>s+c.applications,0),1)
  assert.deepEqual(price([...lines].reverse(),[d,c]).combos,result.combos)
  assert.equal(price([line(),line(sticker,1,1500)],[c,d]).combos.length,0);assert.deepEqual(lines,before)
})
test('componentes solapados no pueden consumir la misma unidad',()=>{
  const c=promo({value:0,components:[{id:id(),kind:'product',targetId:poster,quantity:1},{id:id(),kind:'category',targetId:category,quantity:1}]})
  assert.equal(price([line()],[c]).combos.length,0)
  assert.equal(price([line(),line(sticker,1,1500)],[c]).combos[0].products.reduce((s,p)=>s+p.quantity,0),2)
})
test('límites explícitos de configuración, unidades y búsqueda, sin aproximación',()=>{
  assert.throws(()=>validatePromotion(promo({components:[{id:id(),kind:'product',targetId:poster,quantity:9}]})),/8/)
  assert.throws(()=>validatePromotion(promo({components:Array.from({length:5},()=>({id:id(),kind:'product' as const,targetId:poster,quantity:1}))})),/4/)
  assert.throws(()=>price([line(poster,25),line(sticker,2,1500)]),/24/)
  const c=promo({value:0,components:[{id:id(),kind:'category',targetId:category,quantity:4}]})
  assert.throws(()=>price(Array.from({length:12},()=>line(id(),1,100)),[c]),/128|20.000/)
  const single=promo({value:100,isStackable:true,components:[{id:id(),kind:'product',targetId:poster,quantity:1}]})
  const many=Array.from({length:11},()=>promo({type:'fixed',value:1,components:undefined,isStackable:true}))
  assert.throws(()=>price([line(poster,5)],[single,...many]),/20.000/)
  const unrelated=line(id(),100,10);assert.equal(price([...cart(),unrelated]).total,8500)
})
async function setup() {
  const name=`combos-${id()}`,catalog=new CatalogRepository(name),sales=new SalesRepository(name),promotions=new PromotionRepository(name)
  const a=await catalog.createProduct({id:id(),name:'Póster',categoryIds:[],price:5000,initialStock:1,initialCost:1000,lowStockThreshold:1,isFavorite:false})
  const b=await catalog.createProduct({id:id(),name:'Sticker',categoryIds:[],price:1500,initialStock:1,initialCost:200,lowStockThreshold:1,isFavorite:false})
  return {name,catalog,sales,promotions,a,b}
}
test('venta combo: pagos divididos, stock insuficiente, reintento, historial inmutable y anulación',async()=>{
  const {name,catalog,sales,promotions,a,b}=await setup()
  const c=await promotions.save(promo({components:[{id:id(),kind:'product',targetId:a.id,quantity:1},{id:id(),kind:'product',targetId:b.id,quantity:2}]}))
  const items=[a,b].map((p,i)=>({productId:p.id,quantity:i+1,unitPrice:p.price,expectedRevision:p.revision}))
  const pricing=calculatePromotionPricing(items,[c],undefined,new Date().toISOString())
  const request={operationId:id(),items,pricingSignature:promotionPricingSignature(pricing),payments:[{method:'cash' as const,amount:2000},{method:'transfer' as const,amount:3000},{method:'debit' as const,amount:2500}]}
  const [sale,retry]=await Promise.all([sales.confirm(request),sales.confirm(request)])
  assert.equal(sale.id,retry.id);assert.equal(sale.total,7500);assert.equal(sale.appliedCombos?.[0].applications,1)
  assert.equal(sale.stockDifferences[0].quantity,1);assert.equal((await catalog.listMovements({type:'sale'})).length,2)
  assert.equal((await catalog.snapshot()).products.find(p=>p.id===b.id)?.stock,0)
  await promotions.save({...c,name:'Editado',value:7000,isArchived:true},c.updatedAt)
  await sales.close();await catalog.close()
  const reopened=new SalesRepository(name);assert.deepEqual((await reopened.snapshot()).sales[0],sale)
  const voided=await reopened.voidSale({saleId:sale.id,operationId:id(),reason:'Prueba',returnStock:true})
  assert.deepEqual(voided.appliedCombos,sale.appliedCombos);assert.deepEqual(voided.payments,sale.payments)
  const products=(await catalog.snapshot()).products;assert.equal(products.find(p=>p.id===a.id)?.stock,1);assert.equal(products.find(p=>p.id===b.id)?.stock,1)
  await assert.rejects(reopened.voidSale({saleId:sale.id,operationId:id(),reason:'Otra',returnStock:true}))
  await catalog.close();await reopened.close()
})
test('Pack: stock y costo propios, componentes documentados, venta con descuento y anulación',async()=>{
  const {name,catalog,sales,promotions,a,b}=await setup()
  const pack=await catalog.createProduct({id:id(),kind:'pack',packContents:[{productId:b.id,quantity:5}],name:'Pack stickers',categoryIds:[],price:6000,initialStock:10,initialCost:2000,estimatedUnitCost:2500,lowStockThreshold:2,isFavorite:false})
  const p=await promotions.save(promo({type:'percentage',value:10,components:undefined,productIds:[pack.id]}))
  const sale=await sales.confirm({operationId:id(),items:[{productId:pack.id,quantity:2,unitPrice:pack.price,expectedRevision:pack.revision}],payments:[{method:'debit',amount:10800}]})
  assert.equal(sale.items[0].productKind,'pack');assert.equal(sale.items[0].cost.unitCost,2000);assert.equal(sale.items[0].packContents?.[0].name,b.name)
  assert.equal(sale.appliedPromotions?.[0].id,p.id)
  let products=(await catalog.snapshot()).products;assert.equal(products.find(p=>p.id===pack.id)?.stock,8);assert.equal(products.find(p=>p.id===b.id)?.stock,1)
  assert.equal((await catalog.listMovements({type:'sale'})).length,1)
  await sales.voidSale({saleId:sale.id,operationId:id(),reason:'Prueba pack',returnStock:true})
  await catalog.close();const reopened=new CatalogRepository(name);products=(await reopened.snapshot()).products
  assert.equal(products.find(p=>p.id===pack.id)?.stock,10);assert.equal(products.find(p=>p.id===b.id)?.stock,1);assert.equal(products.find(p=>p.id===a.id)?.stock,1)
  assert.deepEqual(products.find(p=>p.id===pack.id)?.packContents,pack.packContents)
  await assert.rejects(reopened.updateProduct(a.id,{...a,kind:'pack'},a.revision),/tipo/)
  const input={id:id(),kind:'pack' as const,name:'Pack inválido',categoryIds:[],price:100,initialStock:2,lowStockThreshold:1,isFavorite:false}
  await assert.rejects(reopened.createProduct({...input,packContents:[{productId:input.id,quantity:1}]}),/sí mismo/)
  await assert.rejects(reopened.createProduct({...input,packContents:[{productId:id(),quantity:1}]}),/disponible/)
  await assert.rejects(reopened.createProduct({...input,packContents:[{productId:b.id,quantity:0}]}),/positivas/)
  assert.equal((await reopened.snapshot()).products.length,3)
  await reopened.close();await sales.close()
})
test('venta combo de total cero se persiste sin pagos y conserva costos',async()=>{
  const {catalog,sales,promotions,a,b}=await setup()
  await promotions.save(promo({value:0,components:[{id:id(),kind:'product',targetId:a.id,quantity:1}]}))
  const sale=await sales.confirm({operationId:id(),items:[{productId:a.id,quantity:1,unitPrice:a.price,expectedRevision:a.revision}],payments:[]})
  assert.equal(sale.total,0);assert.equal(sale.payments.length,0);assert.equal(sale.items[0].cost.unitCost,1000)
  assert.equal((await catalog.snapshot()).products.find(p=>p.id===b.id)?.stock,1)
  await catalog.close();await sales.close()
})
test('migración v6 a v7 preserva todos los almacenes e identidades; reapertura idempotente',async()=>{
  const {name,catalog,sales,a}=await setup()
  await sales.confirm({operationId:id(),items:[{productId:a.id,quantity:1,unitPrice:a.price,expectedRevision:a.revision}],payments:[{method:'cash',amount:5000}]})
  await catalog.close();await sales.close()
  const source=await openCatalogDatabase(name),stores=[...source.objectStoreNames].filter(s => !['expenses', 'expenseChanges', 'expenseCategories', 'importRecords'].includes(s)),data=new Map<string,unknown[]>()
  for(const store of stores) data.set(store,await source.getAll(store as 'products'))
  source.close()
  const legacyName=`legacy-${id()}`
  const legacy=await openDB(legacyName,6,{upgrade(db){for(const store of stores.filter(store=>store!=='managedEvents')) db.createObjectStore(store,{keyPath:store==='metadata'?'key':'id'})}})
  for(const [store,rows] of data) for(const row of rows) if(store!=='managedEvents'&&!(store==='metadata'&&(row as {key:string}).key==='combos-packs-v1')) await legacy.put(store,row)
  legacy.close()
  const migrated=await openCatalogDatabase(legacyName);assert.equal(migrated.version, 10)
  for(const [store,rows] of data) if(store!=='metadata') assert.deepEqual(await migrated.getAll(store as 'products'),rows)
  assert.equal((await migrated.get('metadata','sale-number'))?.value,1);migrated.close()
  const reopened=await openCatalogDatabase(legacyName);assert.equal((await reopened.getAll('products')).length,2);assert.equal((await reopened.getAll('sales')).length,1);reopened.close()
})
