import 'fake-indexeddb/auto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {openCatalogDatabase} from '../src/services/catalogDatabase.ts'
import {localView,linkCatalog} from '../src/services/firebase/catalogLocal.ts'
import {adoptCatalogAccount,classificationRepairs,repairClassification,assertRepairPreview} from '../src/services/firebase/catalogRepair.ts'
import {project,keyOf} from '../src/services/firebase/catalogModel.ts'
import type {CatalogProduct} from '../src/types/catalog.ts'

async function setup(){
 const name=`repair-${crypto.randomUUID()}`,db=await openCatalogDatabase(name),now=new Date().toISOString()
 const category={id:crypto.randomUUID(),name:'Stickers',isActive:true,order:0,createdAt:now,updatedAt:now}
 const ip={...category,id:crypto.randomUUID(),name:'The Walten Files'}
 const product:CatalogProduct={id:crypto.randomUUID(),name:'New sticker',categoryId:category.id,categoryIds:[category.id],familyIds:[],ipIds:[ip.id],price:600,stock:7,lowStockThreshold:2,averageCost:100,averageCostIsProvisional:false,lastKnownCost:120,estimatedUnitCost:150,isArchived:false,isFavorite:false,createdAt:now,updatedAt:now,revision:4}
 await db.put('categories',category);await db.put('ips',ip);await db.put('products',product);db.close()
 const local=await localView(name)
 await linkCatalog(local,{},Object.keys(local.records).map(key=>({key,action:'upload' as const})),'workspace','original',true,name)
 const payload=project('ips',{...ip,id:crypto.randomUUID()})
 const remote={[keyOf(payload)]:{payload,revision:1,operationId:crypto.randomUUID()}}
 return {name,ip,product,remote,target:keyOf(payload),key:`ips/${ip.id}`}
}
test('account adoption preserves pending operation IDs and rejects different workspace or role',async()=>{
 const s=await setup(),before=await localView(s.name)
 await assert.rejects(adoptCatalogAccount(before,'other','admin','administrator',s.name),/espacio/)
 await assert.rejects(adoptCatalogAccount(before,'workspace','admin','seller',s.name),/administración/)
 assert.equal((await localView(s.name)).token,before.token)
 await adoptCatalogAccount(before,'workspace','admin','administrator',s.name)
 const after=await localView(s.name)
 assert.equal(after.state!.ownerUid,'admin');assert.deepEqual(after.state!.pending,before.state!.pending)
 assert.equal(after.records[`products/${s.product.id}`].id,s.product.id)
})
test('repair preserves UUID, stock and historical costs, retains archived source, rewrites only associations atomically',async()=>{
 const s=await setup();await adoptCatalogAccount(await localView(s.name),'workspace','admin','administrator',s.name)
 const before=await localView(s.name),candidate=classificationRepairs(before,s.remote)[0]
 assert.equal(candidate.products.length,1)
 await repairClassification(before,s.remote,s.key,s.target,'admin','workspace','administrator',s.name)
 const after=await localView(s.name),db=await openCatalogDatabase(s.name),p=await db.get('products',s.product.id),old=await db.get('ips',s.ip.id);db.close()
 assert.equal(p!.id,s.product.id);assert.equal(p!.stock,7);assert.equal(p!.averageCost,100);assert.equal(p!.lastKnownCost,120);assert.equal(p!.estimatedUnitCost,150)
 assert.deepEqual(p!.ipIds,[s.remote[s.target].payload.id]);assert.equal(old!.isActive,false);assert.equal(old!.id,s.ip.id)
 assert.ok(after.state!.excluded.includes(s.key));assert.equal(after.state!.pending[s.key],undefined)
 assert.equal(after.state!.baseline[s.target].revision,1)
 assert.equal(after.state!.pending[`products/${s.product.id}`].payload.entity,'products')
 await assert.rejects(repairClassification(before,s.remote,s.key,s.target,'admin','workspace','administrator',s.name),/cambió/)
 assert.equal((await localView(s.name)).token,after.token)
 assert.equal(classificationRepairs(after,s.remote).length,0)
})
test('stale remote preview and unauthorized repair leave data unchanged',async()=>{
 const s=await setup(),before=await localView(s.name)
 await assert.rejects(assertRepairPreview(before,s.remote,{},s.name),/cambió/)
 await assert.rejects(repairClassification(before,s.remote,s.key,s.target,'seller','workspace','seller',s.name),/administración/)
 assert.equal((await localView(s.name)).token,before.token)
})
