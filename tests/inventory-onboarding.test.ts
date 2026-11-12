import 'fake-indexeddb/auto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {openCatalogDatabase} from '../src/services/catalogDatabase.ts'
import {project as catalogProject,keyOf} from '../src/services/firebase/catalogModel.ts'
import {inventoryView} from '../src/services/firebase/commercial/inventoryLocal.ts'
import {selectInventory,openingSummary,shareInventoryBatch} from '../src/services/firebase/commercial/inventoryOnboarding.ts'
import type {CatalogProduct} from '../src/types/catalog.ts'
import type {InventoryBalance} from '../src/services/firebase/commercial/inventoryProtocol.ts'
async function seed(name: string, id = crypto.randomUUID(), uid = 'a') {
  const db=await openCatalogDatabase(name),now=new Date().toISOString()
  const category={id:crypto.randomUUID(),name:'Stickers',isActive:true,order:0,createdAt:now,updatedAt:now,activeName:'stickers'}
  const p:CatalogProduct={id,name:'Producto',activeName:'producto',categoryId:category.id,categoryIds:[category.id],familyIds:[],ipIds:[],price:600,stock:77,lowStockThreshold:0,averageCost:100,lastKnownCost:100,estimatedUnitCost:150,averageCostIsProvisional:false,isArchived:false,isFavorite:false,createdAt:now,updatedAt:now,revision:1}
  await db.put('categories',category);await db.put('products',p)
  const payload=catalogProject('products',p),categoryPayload=catalogProject('categories',category)
  await db.put('catalogSync',{key:'catalog',workspaceId:'space',ownerUid:uid,deviceId:crypto.randomUUID(),canWrite:true,baseline:{[keyOf(payload)]:{payload,revision:1,operationId:crypto.randomUUID()},[keyOf(categoryPayload)]:{payload:categoryPayload,revision:1,operationId:crypto.randomUUID()}},pending:{},excluded:[],conflicts:{}})
  db.close();return p
}

async function fixture(){const name=crypto.randomUUID(),p=await seed(name),db=await openCatalogDatabase(name),state=(await db.get('catalogSync','catalog'))!;const second={...p,id:crypto.randomUUID(),name:'Segundo',activeName:'segundo',stockCountPending:true};await db.put('products',second);const payload=catalogProject('products',second);state.baseline[keyOf(payload)]={payload,revision:1,operationId:crypto.randomUUID()};await db.put('catalogSync',state);db.close();return{name,p,second}}
test('select all respects archived/included and deselect all has empty summary',async()=>{
 const {name,p,second}=await fixture(),v=await inventoryView(name)
 assert.equal(Object.keys(selectInventory(v.products,[],{},'unknown',true)).length,2)
 assert.equal(Object.keys(selectInventory(v.products,[p.id],{},'unknown',true)).length,1)
 assert.equal(Object.keys(selectInventory([{...p,isArchived:true},second],[],{},'unknown',true)).length,1)
 assert.equal(openingSummary({}).total,0)
 assert.equal(Object.keys(selectInventory(v.products,[],{},'unknown',false)).length,0)
})
test('reviewed quantities preserve unknown vs confirmed zero and reject missing/decimal values',async()=>{
 const {name,p,second}=await fixture(),v=await inventoryView(name),rows=selectInventory(v.products.map(x=>x.id===p.id?{...x,stock:0}:x),[],{},'count',true)
 assert.equal(rows[p.id].quantity,0);assert.equal(rows[second.id].quantity,undefined);assert.equal(openingSummary(rows).invalid,true)
 rows[second.id].quantity=2;assert.equal(openingSummary(rows).invalid,false);rows[second.id].quantity=2.5;assert.equal(openingSummary(rows).invalid,true)
})
test('bulk unknown openings durable, progress per product, retry never duplicates UUIDs',async()=>{
 const {name}=await fixture(),v=await inventoryView(name),rows=selectInventory(v.products,[],{},'unknown',true),progress:number[]=[]
 const result=await shareInventoryBatch(Object.values(rows),{},v,'space','a',true,r=>progress.push(r.length),name)
 assert.deepEqual(progress,[1,2]);assert.ok(result.every(r=>r.status==='queued'))
 const saved=await inventoryView(name);assert.ok(saved.products.every(p=>p.stockCountPending));assert.equal(saved.state!.operations.length,2)
 const ids=saved.state!.operations.map(o=>o.intent.operationId)
 const retry=await shareInventoryBatch(Object.values(rows),{},v,'space','a',true,()=>{},name);assert.ok(retry.every(r=>r.status==='already'));assert.deepEqual((await inventoryView(name)).state!.operations.map(o=>o.intent.operationId),ids)
})
test('partial selection creates only requested count and rejects changed product without losing other successes',async()=>{
 const {name,p,second}=await fixture(),v=await inventoryView(name),db=await openCatalogDatabase(name);await db.put('products',{...second,stock:20,revision:2});db.close()
 const result=await shareInventoryBatch([{productId:p.id,action:'count',quantity:0},{productId:second.id,action:'unknown'}],{},v,'space','a',true,()=>{},name)
 assert.deepEqual(result.map(r=>r.status),['queued','error']);const saved=await inventoryView(name);assert.deepEqual(saved.state!.products,[p.id]);assert.equal(saved.state!.operations.length,2);assert.equal(saved.products.find(x=>x.id===p.id)!.stockCountPending,false)
})
test('remote confirmed quantity is received, never overwritten; one invalid row does not abort remaining products',async()=>{
 const {name,p,second}=await fixture(),v=await inventoryView(name)
 const balance:InventoryBalance={productId:p.id,stock:12,countPending:false,revision:3,operationId:crypto.randomUUID(),costs:{averageCost:null,lastKnownCost:null,estimatedUnitCost:null,averageCostIsProvisional:true}}
 const remote={[p.id]:balance},rows=selectInventory(v.products,[],remote,'count',true);assert.equal(rows[p.id].action,'receive')
 const result=await shareInventoryBatch([{productId:second.id,action:'count'},rows[p.id]],remote,v,'space','a',true,()=>{},name)
 assert.deepEqual(result.map(r=>r.status),['error','received']);const saved=await inventoryView(name);assert.equal(saved.products.find(x=>x.id===p.id)!.stock,12);assert.equal(saved.state!.operations.length,0)
 await assert.rejects(()=>shareInventoryBatch([rows[p.id],rows[p.id]],remote,v,'space','a',true,()=>{},name),/repetidos/)
})
