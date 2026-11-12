import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { commercialView, linkCommercial, receiveConfiguration, collectConfiguration, receiveSales } from '../src/services/firebase/commercial/commercialLocal.ts'
import { planSharedSale, planSharedVoid } from '../src/services/firebase/commercial/saleProtocol.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import { createBackup, parseBackup, restoreBackup } from '../src/services/data/backup.ts'
import { readData, snapshotToken } from '../src/services/data/snapshot.ts'
import { enqueueInventory } from '../src/services/firebase/commercial/inventoryLocal.ts'
import type { CatalogProduct } from '../src/types/catalog.ts'
import type { InventoryBalance } from '../src/services/firebase/commercial/inventoryProtocol.ts'
import { buildAnalytics } from '../src/services/analytics.ts'
async function fixture(name:string,uid='a',productId=crypto.randomUUID(),categoryId=crypto.randomUUID()){
  const db=await openCatalogDatabase(name),now=new Date().toISOString(),deviceId=crypto.randomUUID()
  const product:CatalogProduct={id:productId,name:'Sticker',activeName:'sticker',categoryId,categoryIds:[categoryId],familyIds:[],ipIds:[],price:600,stock:10,lowStockThreshold:0,isFavorite:false,isArchived:false,averageCostIsProvisional:true,createdAt:now,updatedAt:now,revision:1,inventoryShared:true}
  await db.put('categories',{id:categoryId,name:'Stickers',isActive:true,order:0,createdAt:now,updatedAt:now});await db.put('products',product)
  await db.put('catalogSync',{key:'catalog',ownerUid:uid,workspaceId:'space',deviceId,canWrite:true,baseline:{},pending:{},conflicts:{},excluded:[]})
  const balance:InventoryBalance={productId,stock:10,countPending:false,revision:1,operationId:crypto.randomUUID(),costs:{averageCost:null,lastKnownCost:null,estimatedUnitCost:null,averageCostIsProvisional:true}}
  await db.put('inventorySync',{key:'inventory',ownerUid:uid,workspaceId:'space',deviceId,canWrite:true,products:[productId],baseline:{[productId]:balance},originals:{},operations:[]});db.close()
  await linkCommercial((await commercialView(name)).token,null,'local',uid,'space',true,name)
  const pending=(await commercialView(name)).state!.configurationPending!
  await receiveConfiguration({revision:1,operationId:pending.operationId,payload:pending.payload},uid,name)
  return{product,balance,deviceId}
}
test('durable sale survives reopening/backup, receives exact ACK and deduplicates history in two databases',async()=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),{product,balance}=await fixture(a)
  await fixture(b,'b',product.id,product.categoryId)
  let repo=new SalesRepository(a)
  const input={operationId:crypto.randomUUID(),items:[{productId:product.id,quantity:2,unitPrice:600,expectedRevision:1}],payments:[{method:'cash' as const,amount:400},{method:'transfer' as const,amount:800}]}
  const sale=await repo.confirm(input,{uid:'a',workspaceId:'space'});assert.equal(sale.sharedStatus,'pending');await repo.close()
  repo=new SalesRepository(a);assert.equal((await repo.confirm(input,{uid:'a',workspaceId:'space'})).id,sale.id);await repo.close()
  const data=await readData(a),backup=await parseBackup(await createBackup(data)),restored=crypto.randomUUID()
  await restoreBackup(backup.data,snapshotToken(await readData(restored)),restored)
  const op=(await commercialView(restored)).state!.operations[0];assert.equal(op.kind,'sale');if(op.kind!=='sale')throw new Error('Missing sale')
  assert.equal(op.intent.sale.operationId,input.operationId)
  await assert.rejects(()=>enqueueInventory({id:crypto.randomUUID(),productId:product.id,type:'count',quantity:7,expectedRevision:2},'a','space',a),/ventas pendientes/)
  const receipt=planSharedSale(op.intent,{[product.id]:balance}),row={operation:{kind:'sale' as const,receipt},cursor:{seconds:1,nanoseconds:0,id:input.operationId}}
  await receiveSales([row],'a','space',a);await receiveSales([row,row],'b','space',b)
  for(const name of[a,b]){const saved=await readData(name);assert.equal(saved.sales.length,1);assert.equal(saved.sales[0].sharedStatus,'confirmed');assert.equal(saved.payments.length,2);assert.equal(saved.movements.length,1);assert.equal(saved.products[0].stock,8);await createBackup(saved)}
  const voidIntent={schemaVersion:1 as const,operationId:crypto.randomUUID(),saleId:sale.id,actorUid:'a',deviceId:op.intent.deviceId,occurredAt:new Date().toISOString(),reason:'Error',returnStock:true,movementIds:[crypto.randomUUID()]}
  const cancelled=planSharedVoid(voidIntent,receipt.sale,receipt.after),voidRow={operation:{kind:'void' as const,receipt:cancelled},cursor:{seconds:2,nanoseconds:0,id:voidIntent.operationId}}
  await receiveSales([voidRow],'a','space',a);await receiveSales([voidRow],'b','space',b)
  assert.equal((await readData(b)).products[0].stock,10);assert.equal((await readData(b)).sales[0].status,'voided')
  await receiveSales([row],'b','space',b);assert.equal((await readData(b)).sales[0].status,'voided')
})
test('event changes are durable, shared active event invalidates checkout, concurrent configuration is retained for review',async()=>{
  const name=crypto.randomUUID();const {product}=await fixture(name),events=new EventRepository(name),id=crypto.randomUUID()
  const event=await events.save(id,{name:'Feria',startDate:'2026-11-11',endDate:'2026-11-12'})
  await events.activate(id,event.updatedAt)
  let state=await collectConfiguration('a',true,name);assert.equal(state!.configurationPending!.payload.events[0].status,'active')
  const pending=state!.configurationPending!
  await receiveConfiguration({revision:2,operationId:pending.operationId,payload:pending.payload},'a',name)
  const repo=new SalesRepository(name)
  await assert.rejects(()=>repo.confirm({operationId:crypto.randomUUID(),items:[{productId:product.id,quantity:1,unitPrice:600,expectedRevision:1}],payments:[{method:'cash',amount:600}],priceReview:{eventId:null,revision:0}},{uid:'a',workspaceId:'space'}),/evento cambió/);await repo.close()
  const active=(await events.snapshot())[0];await events.save(id,{...active,name:'Feria local'},active.updatedAt)
  await collectConfiguration('a',true,name)
  await receiveConfiguration({revision:3,operationId:crypto.randomUUID(),payload:{...pending.payload,events:[{...active,name:'Feria remota'}]}},'a',name)
  state=(await commercialView(name)).state;assert.equal(state!.configurationConflict,true);assert.equal((await events.snapshot())[0].name,'Feria local');assert.equal(state!.configurationPending!.payload.events[0].name,'Feria local')
})
test('zero total discount is shared with unchanged historical snapshots and excluded from confirmed statistics until ACK',async()=>{
  const name=crypto.randomUUID(),{product,balance}=await fixture(name),repo=new SalesRepository(name)
  const sale=await repo.confirm({operationId:crypto.randomUUID(),items:[{productId:product.id,quantity:1,unitPrice:600,expectedRevision:1}],generalDiscount:{type:'percentage',value:100},payments:[]},{uid:'a',workspaceId:'space'})
  await repo.close();assert.equal(sale.total,0);assert.equal(sale.discount,600)
  assert.equal(buildAnalytics([sale],[]).records.length,0)
  const op=(await commercialView(name)).state!.operations[0];if(op.kind!=='sale')throw new Error('Missing sale')
  const receipt=planSharedSale(op.intent,{[product.id]:balance})
  await receiveSales([{operation:{kind:'sale',receipt},cursor:{seconds:1,nanoseconds:0,id:sale.operationId}}],'a','space',name)
  const saved=await readData(name);assert.equal(buildAnalytics(saved.sales,[]).records.length,1);assert.equal(saved.sales[0].discount,600);assert.equal(saved.sales[0].payments.length,0)
  await createBackup(saved)
})
