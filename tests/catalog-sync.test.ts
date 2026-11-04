import 'fake-indexeddb/auto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {openCatalogDatabase} from '../src/services/catalogDatabase.ts'
import {includeUploadDependencies,localView,preview,linkCatalog,reconcile,flush,resolveConflict,unlinkCatalog} from '../src/services/firebase/catalogLocal.ts'
import {project,keyOf,mergeProduct} from '../src/services/firebase/catalogModel.ts'
import type {RemoteRecord,Pending} from '../src/services/firebase/catalogModel.ts'
import type {CatalogProduct} from '../src/types/catalog.ts'
import {readData} from '../src/services/data/snapshot.ts'
import {createBackup,parseBackup,prepareRestore,digest} from '../src/services/data/backup.ts'
import {canonical} from '../src/services/data/snapshot.ts'
import {openDB} from 'idb'
const now=new Date().toISOString()
test('preview dependency selection preserves excluded fixtures and never links or writes',async()=>{
 const name=`preview-dependencies-${crypto.randomUUID()}`,db=await openCatalogDatabase(name)
 const category={id:crypto.randomUUID(),name:'Real category',isActive:true,order:0,createdAt:now,updatedAt:now}
 const fixture={...category,id:crypto.randomUUID(),name:'Excluded test family'}
 const product={id:crypto.randomUUID(),name:'Real product',categoryId:category.id,categoryIds:[category.id],familyIds:[],ipIds:[],price:600,stock:9,lowStockThreshold:2,isArchived:false,isFavorite:false,createdAt:now,updatedAt:now} as CatalogProduct
 await db.put('categories',category);await db.put('families',fixture);await db.put('products',product);db.close()
 const local=await localView(name)
 const choices=Object.keys(local.records).map(key=>({key,action:key.startsWith('products/')?'upload' as const:'exclude' as const}))
 const selected=includeUploadDependencies(local,{},choices)
 assert.equal(selected.find(c=>c.key===`categories/${category.id}`)?.action,'upload')
 assert.equal(selected.find(c=>c.key===`families/${fixture.id}`)?.action,'exclude')
 assert.equal(choices.find(c=>c.key===`categories/${category.id}`)?.action,'exclude')
 assert.equal((await localView(name)).token,local.token)
 await assert.rejects(linkCatalog(local,{},choices,'workspace','admin',true,name),/clasificaciones/)
 assert.equal((await localView(name)).state,undefined)
 await linkCatalog(local,{},selected,'workspace','admin',true,name)
 assert.equal(Object.keys((await localView(name)).state!.pending).length,2)
 assert.equal((await readData(name)).products[0].stock,9)
})
test('two local devices: explicit selection, queued edits, restart, conflict and stock isolation',async()=>{
 const a=`test-sync-a-${crypto.randomUUID()}`,b=`test-sync-b-${crypto.randomUUID()}`
 const category={id:crypto.randomUUID(),name:'Sticker',isActive:true,order:0,createdAt:now,updatedAt:now}
 const product:CatalogProduct={id:crypto.randomUUID(),name:'Cat',categoryIds:[category.id],categoryId:category.id,familyIds:[],ipIds:[],price:600,stock:7,lowStockThreshold:2,averageCost:100,lastKnownCost:120,estimatedUnitCost:150,averageCostIsProvisional:false,isFavorite:false,isArchived:false,createdAt:now,updatedAt:now,revision:1,activeName:'cat'}
 const db=await openCatalogDatabase(a);await db.put('categories',category);await db.put('products',product);db.close()
 const local=await localView(a);assert.equal(local.state,undefined);assert.equal(preview(local,{}).length,2)
 await linkCatalog(local,{},Object.keys(local.records).map(key=>({key,action:'upload'})),'workspace','admin',true,a)
 const remote:Record<string,RemoteRecord>={},receipts=new Map<string,RemoteRecord>()
 const transport={async commit(op:Pending){if(receipts.has(op.id))return receipts.get(op.id)!
   const key=keyOf(op.payload);if((remote[key]?.revision??0)!==op.expectedRevision)throw new Error('CONFLICT')
   const row={payload:op.payload,revision:op.expectedRevision+1,operationId:op.id};remote[key]=row;receipts.set(op.id,row);return row}}
 await flush(transport,a);assert.equal(Object.keys(remote).length,2)
 const empty=await localView(b);await linkCatalog(empty,remote,Object.keys(remote).map(key=>({key,action:'download'})),'workspace','admin',true,b)
 const dbB=await openCatalogDatabase(b),received=await dbB.get('products',product.id)
 assert.equal(received?.stock,0);assert.equal(received?.stockCountPending,true);assert.equal(received?.averageCost,undefined)
 assert.equal((await readData(a)).products[0].stock,7)
 const current=await dbB.get('products',product.id);await dbB.put('products',{...current!,price:900});dbB.close()
 await reconcile(remote,true,b);assert.equal(Object.keys((await localView(b)).state!.pending).length,1)
 // Closing/reopening connections retains the same operation ID and payload.
 const queued=(await localView(b)).state!.pending[`products/${product.id}`].id
 assert.equal((await localView(b)).state!.pending[`products/${product.id}`].id,queued)
 await flush(transport,b);await reconcile(remote,true,a)
 const after=(await readData(a)).products[0];assert.equal(after.price,900);assert.equal(after.stock,7);assert.equal(after.averageCost,100);assert.equal(after.estimatedUnitCost,150)
 await reconcile(remote,true,a)
 assert.equal(Object.keys((await localView(a)).state!.pending).length,0,'Remote application must not echo a write back')
 const da=await openCatalogDatabase(a);await da.put('products',{...after,price:1000});da.close()
 remote[`products/${product.id}`]={payload:{...project('products',after),name:'Cloud edited'},revision:3,operationId:crypto.randomUUID()}
 await reconcile(remote,true,a);assert.ok((await localView(a)).state!.conflicts[`products/${product.id}`])
 assert.equal((await readData(a)).products[0].price,1000)
 await resolveConflict(`products/${product.id}`,'remote',remote,true,a)
 assert.equal((await readData(a)).products[0].stock,7)
 const data=await readData(a),backup=await createBackup(data),parsed=await parseBackup(backup)
 assert.equal(parsed.data.catalogSync[0].deviceId,data.catalogSync[0].deviceId)
 await assert.rejects(prepareRestore(backup,a),/vinculado/)
})
test('projection excludes stock, costs, event prices, images and histories',()=>{
 const payload={entity:'products' as const,id:crypto.randomUUID(),name:'Pack',description:'',createdAt:now,categoryId:crypto.randomUUID(),familyIds:[],ipIds:[],price:0,isArchived:true,isFavorite:false,kind:'pack' as const}
 const received=mergeProduct(payload)
 const projected=project('products',{...received,stock:99,averageCost:10,eventPrices:[{eventId:crypto.randomUUID(),price:50}],image:new Blob(['image'])})
 assert.equal('stock' in projected,false);assert.equal('averageCost' in projected,false);assert.equal('image' in projected,false);assert.equal('eventPrices' in projected,false)
})
test('initial selection excludes fixtures, stale previews abort, lost acknowledgments replay once',async()=>{
 const name=`sync-boundary-${crypto.randomUUID()}`,db=await openCatalogDatabase(name)
 const row={id:crypto.randomUUID(),name:'Excluded fixture',createdAt:now,updatedAt:now,isActive:true,order:0}
 await db.put('families',row)
 const stale=await localView(name);await db.put('families',{...row,name:'Changed'})
 await assert.rejects(linkCatalog(stale,{},[{key:`families/${row.id}`,action:'upload'}],'w','a',true,name),/cambió/)
 assert.equal((await localView(name)).state,undefined)
 const local=await localView(name)
 await linkCatalog(local,{},[{key:`families/${row.id}`,action:'exclude'}],'w','a',true,name)
 await reconcile({},true,name);assert.equal(Object.keys((await localView(name)).state!.pending).length,0)
 const newRow={...row,id:crypto.randomUUID(),name:'New after linking'};await db.put('ips',newRow);db.close()
 await reconcile({},true,name);await assert.rejects(unlinkCatalog(name),/pendientes/)
 let writes=0,first=true;const receipts=new Map<string,RemoteRecord>()
 const transport={async commit(p:Pending){let ack=receipts.get(p.id);if(!ack){ack={payload:p.payload,revision:1,operationId:p.id};receipts.set(p.id,ack);writes++}if(first){first=false;throw new Error('Network response lost')}return ack}}
 await assert.rejects(flush(transport,name),/Network/)
 assert.equal(Object.keys((await localView(name)).state!.pending).length,1)
 await flush(transport,name);assert.equal(writes,1)
 await unlinkCatalog(name);assert.equal((await localView(name)).state,undefined)
 assert.equal(Object.keys((await localView(name)).records).length,2)
})
test('migration v10 adds only catalogSync; old backups retain all entities',async()=>{
 const name=`sync-migration-${crypto.randomUUID()}`
 const old=await openDB(name,10,{upgrade(db){db.createObjectStore('products',{keyPath:'id'});db.createObjectStore('metadata',{keyPath:'key'})}})
 const fixture={id:crypto.randomUUID(),opaque:'preserved original bytes',stock:-3,averageCost:0}
 await old.put('products',fixture);await old.put('metadata',{key:'sale-number',value:8});old.close()
 const next=await openCatalogDatabase(name)
 assert.equal(next.version,11);assert.deepEqual(await next.get('products',fixture.id),fixture);assert.equal(await next.count('catalogSync'),0);assert.deepEqual(await next.get('metadata','sale-number'),{key:'sale-number',value:8});next.close()
 const data=await readData(`legacy-backup-${crypto.randomUUID()}`)
 const envelope=JSON.parse(await createBackup(data));envelope.databaseVersion=10;delete envelope.data.catalogSync;delete envelope.counts.catalogSync
 const {sha256:_old,...body}=envelope;envelope.sha256=await digest(canonical(body))
 const restored=await parseBackup(JSON.stringify(envelope));assert.deepEqual(restored.data.catalogSync,[]);assert.deepEqual(restored.data.expenseCategories,data.expenseCategories)
})
