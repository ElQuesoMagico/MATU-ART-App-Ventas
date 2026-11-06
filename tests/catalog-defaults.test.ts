import 'fake-indexeddb/auto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {openCatalogDatabase} from '../src/services/catalogDatabase.ts'
import {localView,linkEmptyCatalog,linkCatalog,initialChoices,reconcile,flush} from '../src/services/firebase/catalogLocal.ts'
import {includeCatalogRecords,bulkInclusionPreview} from '../src/services/firebase/catalogInclusion.ts'
import {EntityAdministration} from '../src/services/entityAdministration.ts'
import type {RemoteRecord,Pending} from '../src/services/firebase/catalogModel.ts'
import type {CatalogProduct} from '../src/types/catalog.ts'

async function seed(name:string){
 const db=await openCatalogDatabase(name),now=new Date().toISOString()
 const category={id:crypto.randomUUID(),name:'Stickers',isActive:true,order:0,createdAt:now,updatedAt:now}
 const family={...category,id:crypto.randomUUID(),name:'Series'},ip={...category,id:crypto.randomUUID(),name:'Original'}
 const product:CatalogProduct={id:crypto.randomUUID(),name:'Comercial',categoryId:category.id,categoryIds:[category.id],familyIds:[family.id],ipIds:[ip.id],price:600,stock:8,lowStockThreshold:0,averageCost:100,averageCostIsProvisional:false,isArchived:false,isFavorite:false,createdAt:now,updatedAt:now,revision:1}
 await db.put('categories',category);await db.put('families',family);await db.put('ips',ip);await db.put('products',product);db.close()
 return {product,key:`products/${product.id}`,ref:`categories/${category.id}`}
}
function transport(remote:Record<string,RemoteRecord>){return {commit:async(p:Pending)=>{
 const key=`${p.payload.entity}/${p.payload.id}`,current=remote[key]
 if(current?.operationId===p.id)return current
 if((current?.revision??0)!==p.expectedRevision)throw new Error('CONFLICT revision')
 return remote[key]={payload:p.payload,revision:p.expectedRevision+1,operationId:p.id}
}}}

test('empty device joins automatically; new product and all classifications propagate both ways without exclusions',async()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID(),remote:Record<string,RemoteRecord>={}
 assert.equal(await linkEmptyCatalog(remote,'space','admin',true,a),true)
 const s=await seed(a),server=transport(remote)
 await reconcile(remote,true,a);await flush(server,a)
 assert.equal(Object.keys(remote).length,4)
 assert.equal(await linkEmptyCatalog(remote,'space','other',true,b),true)
 assert.equal((await localView(b)).records[s.key].name,'Comercial')
 const db=await openCatalogDatabase(b),product=(await db.get('products',s.product.id))!
 assert.equal(product.stock,0);assert.equal(product.stockCountPending,true);assert.equal(product.averageCost,undefined)
 await db.put('products',{...product,name:'Editado en B'});db.close()
 await reconcile(remote,true,b);await flush(server,b);await reconcile(remote,true,a)
 assert.equal((await localView(a)).records[s.key].name,'Editado en B')
 for(const archived of [true,false]){
  const db=await openCatalogDatabase(a),p=(await db.get('products',s.product.id))!
  await db.put('products',{...p,isArchived:archived});db.close()
  await reconcile(remote,true,a);await flush(server,a);await reconcile(remote,true,b)
  const p2=(await localView(b)).records[s.key];assert.equal(p2.entity==='products'&&p2.isArchived,archived)
 }
 await reconcile(remote,true,b);await flush(server,b)
 assert.equal(Object.keys((await localView(b)).state!.pending).length,0)
 assert.deepEqual((await localView(a)).state!.excluded,[])
 const dbA=await openCatalogDatabase(a);assert.equal((await dbA.get('products',s.product.id))!.stock,8);dbA.close()
 assert.equal((await new EntityAdministration(a).review('products',s.product.id)).allowed,false)
})

test('offline edit survives reopen, reconnect sends once; concurrent revision becomes conflict',async()=>{
 const name=crypto.randomUUID(),remote:Record<string,RemoteRecord>={}
 await linkEmptyCatalog(remote,'space','admin',true,name);const s=await seed(name)
 await reconcile({},true,name)
 const pending=(await localView(name)).state!.pending
 await reconcile({},true,name);assert.deepEqual((await localView(name)).state!.pending,pending)
 await flush(transport(remote),name);await flush(transport(remote),name)
 assert.equal(remote[s.key].revision,1)
 const db=await openCatalogDatabase(name),p=(await db.get('products',s.product.id))!
 await db.put('products',{...p,price:800});db.close()
 remote[s.key]={...remote[s.key],revision:2,payload:{...remote[s.key].payload,name:'Otra edición'}}
 await reconcile(remote,true,name)
 assert.match((await localView(name)).state!.conflicts[s.key],/concurrente/)
 assert.equal(remote[s.key].payload.name,'Otra edición')
})

test('old local records require review; initial exact UUID matches download while unknown records stay local',async()=>{
 const name=crypto.randomUUID(),s=await seed(name),local=await localView(name)
 const remote:Record<string,RemoteRecord>={[s.key]:{payload:local.records[s.key],revision:1,operationId:crypto.randomUUID()}}
 assert.equal(await linkEmptyCatalog(remote,'space','admin',true,name),false)
 assert.equal((await localView(name)).state,undefined)
 const choices=initialChoices(local,remote)
 assert.equal(choices.find(c=>c.key===s.key)!.action,'download')
 assert.equal(choices.find(c=>c.key===s.ref)!.action,'exclude')
})

test('bulk migration keeps test exclusions, supports explicit differing classification, persists and is atomic on stale preview',async()=>{
 const name=crypto.randomUUID(),s=await seed(name),db=await openCatalogDatabase(name)
 const qa={...s.product,id:crypto.randomUUID(),name:'QA test'};await db.put('products',qa);db.close()
 const local=await localView(name),remote:Record<string,RemoteRecord>=Object.fromEntries(Object.entries(local.records).filter(([k])=>k!==`products/${qa.id}`).map(([k,payload])=>[k,{payload:{...payload,name:k===s.ref?'Categoría remota':payload.name},revision:1,operationId:crypto.randomUUID()}]))
 await linkCatalog(local,remote,Object.keys(local.records).map(key=>({key,action:'exclude'})),'space','admin',true,name)
 const before=await localView(name),selections=[{key:s.key,choice:'local' as const},{key:s.ref,choice:'local' as const}]
 assert.throws(()=>bulkInclusionPreview(before,remote,[selections[0]]),/difiere/)
 await includeCatalogRecords(before,remote,selections,'admin','space','administrator',name)
 const after=await localView(name)
 assert.deepEqual(after.state!.excluded,[`products/${qa.id}`])
 assert.equal(after.state!.pending[s.ref].expectedRevision,1)
 await assert.rejects(includeCatalogRecords(before,remote,selections,'admin','space','administrator',name),/cambió/)
 assert.equal((await localView(name)).token,after.token)
})

test('invalid local catalog is never treated as empty; missing cloud references roll back automatic join',async()=>{
 const name=crypto.randomUUID(),s=await seed(name),db=await openCatalogDatabase(name)
 await db.clear('categories');await db.clear('families');await db.clear('ips');await db.put('products',{...s.product,categoryId:undefined});db.close()
 assert.equal(await linkEmptyCatalog({},'space','admin',true,name),false)
 const blank=crypto.randomUUID(),local=await localView(blank),valid=await seed(crypto.randomUUID())
 const payload={...s.product,id:valid.product.id,entity:'products' as const,kind:'product' as const,description:''}
 await assert.rejects(linkEmptyCatalog({[`products/${payload.id}`]:{payload,revision:1,operationId:crypto.randomUUID()}},'space','admin',true,blank),/clasificación/)
 assert.equal((await localView(blank)).token,local.token)
})
