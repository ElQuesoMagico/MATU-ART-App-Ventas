import 'fake-indexeddb/auto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {openCatalogDatabase} from '../src/services/catalogDatabase.ts'
import {localView,linkCatalog,flush,reconcile} from '../src/services/firebase/catalogLocal.ts'
import {includeCatalogRecord,inclusionPreview} from '../src/services/firebase/catalogInclusion.ts'
import {assertRepairPreview} from '../src/services/firebase/catalogRepair.ts'
import type {RemoteRecord} from '../src/services/firebase/catalogModel.ts'
import type {CatalogProduct} from '../src/types/catalog.ts'

async function setup(){
 const name=`inclusion-${crypto.randomUUID()}`,db=await openCatalogDatabase(name),now=new Date().toISOString()
 const category={id:crypto.randomUUID(),name:'Stickers',isActive:true,order:0,createdAt:now,updatedAt:now}
 const product:CatalogProduct={id:crypto.randomUUID(),name:'Sticker Ame chan',categoryId:category.id,categoryIds:[category.id],familyIds:[],ipIds:[],price:600,stock:7,lowStockThreshold:2,averageCost:100,averageCostIsProvisional:false,lastKnownCost:120,isArchived:false,isFavorite:false,createdAt:now,updatedAt:now}
 await db.put('categories',category);await db.put('products',product);db.close()
 const local=await localView(name),key=`products/${product.id}`,ref=`categories/${category.id}`
 const remote:Record<string,RemoteRecord>=Object.fromEntries(Object.entries(local.records).map(([k,payload])=>[k,{payload:k===key?{...payload,name:'Ame chan'}:payload,revision:1,operationId:crypto.randomUUID()}]))
 await linkCatalog(local,remote,Object.keys(local.records).map(key=>({key,action:'exclude' as const})),'workspace','admin',true,name)
 return {name,key,ref,remote,product}
}

test('include local queues CAS upload, includes required classification, survives reopen and rejects duplicate/stale confirmation',async()=>{
 const s=await setup(),before=await localView(s.name)
 assert.deepEqual(inclusionPreview(before,s.remote,s.key,'local').map(e=>e.action),['match','upload'])
 await includeCatalogRecord(before,s.remote,s.key,'local','admin','workspace','administrator',s.name)
 const after=await localView(s.name)
 assert.equal(after.state!.pending[s.key].payload.name,'Sticker Ame chan')
 assert.equal(after.state!.pending[s.key].expectedRevision,1)
 assert.equal(after.state!.excluded.length,0)
 assert.equal(after.state!.baseline[s.ref].revision,1)
 await assert.rejects(includeCatalogRecord(before,s.remote,s.key,'local','admin','workspace','administrator',s.name),/cambió/)
 assert.throws(()=>inclusionPreview(after,s.remote,s.key,'local'),/excluido/)
 assert.equal((await localView(s.name)).token,after.token)
})

test('receive remote preserves UUID stock and costs; seller cannot upload',async()=>{
 const s=await setup(),before=await localView(s.name)
 await assert.rejects(includeCatalogRecord(before,s.remote,s.key,'local','admin','workspace','seller',s.name),/Vendedor/)
 await includeCatalogRecord(before,s.remote,s.key,'remote','admin','workspace','seller',s.name)
 const db=await openCatalogDatabase(s.name),product=await db.get('products',s.product.id);db.close()
 assert.equal(product!.name,'Ame chan');assert.equal(product!.id,s.product.id)
 assert.equal(product!.stock,7);assert.equal(product!.averageCost,100);assert.equal(product!.lastKnownCost,120)
 assert.equal(Object.keys((await localView(s.name)).state!.pending).length,0)
})

test('classification inclusion leaves unrelated exclusions intact and rejects different account',async()=>{
 const s=await setup(),before=await localView(s.name)
 await assert.rejects(includeCatalogRecord(before,s.remote,s.ref,'remote','other','workspace','administrator',s.name),/cuenta/)
 await includeCatalogRecord(before,s.remote,s.ref,'remote','admin','workspace','administrator',s.name)
 assert.deepEqual((await localView(s.name)).state!.excluded,[s.key])
})

test('missing/differing dependencies and remote name collisions fail without modifying data',async()=>{
 const s=await setup(),before=await localView(s.name),different=structuredClone(s.remote)
 different[s.ref].payload.name='Otra categoría'
 assert.throws(()=>inclusionPreview(before,different,s.key,'local'),/difiere/)
 const missing=structuredClone(s.remote);delete missing[s.ref]
 assert.throws(()=>inclusionPreview(before,missing,s.key,'remote'),/Falta/)
 const collision=structuredClone(s.remote),other=crypto.randomUUID()
 collision[`products/${other}`]={...collision[s.key],payload:{...before.records[s.key],id:other}}
 assert.throws(()=>inclusionPreview(before,collision,s.key,'local'),/UUID/)
 await assert.rejects(assertRepairPreview(before,s.remote,different,s.name),/cambió/)
 assert.equal((await localView(s.name)).token,before.token)
})

test('included edit uploads once, subsequent archive is queued and remote revision is received',async()=>{
 const s=await setup(),before=await localView(s.name)
 await includeCatalogRecord(before,s.remote,s.key,'local','admin','workspace','administrator',s.name)
 let calls=0
 const transport={commit:async(p:NonNullable<typeof before.state>['pending'][string])=>{
   calls++;assert.equal(p.expectedRevision,s.remote[s.key].revision)
   const ack={payload:p.payload,revision:p.expectedRevision+1,operationId:p.id};s.remote[s.key]=ack;return ack
 }}
 await flush(transport,s.name);await flush(transport,s.name)
 assert.equal(calls,1);assert.equal(s.remote[s.key].payload.name,'Sticker Ame chan')
 const db=await openCatalogDatabase(s.name),product=(await db.get('products',s.product.id))!
 await db.put('products',{...product,isArchived:true});db.close()
 await reconcile(s.remote,true,s.name);await flush(transport,s.name)
 assert.equal(calls,2)
 const remoteProduct=s.remote[s.key].payload
 assert.equal(remoteProduct.entity==='products'&&remoteProduct.isArchived,true)
 s.remote[s.key]={...s.remote[s.key],revision:4,payload:{...remoteProduct,name:'Cambio remoto'}}
 await reconcile(s.remote,true,s.name)
 assert.equal((await localView(s.name)).records[s.key].name,'Cambio remoto')
})
