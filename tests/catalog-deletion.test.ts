import {createBackup,parseBackup} from '../src/services/data/backup.ts'
import 'fake-indexeddb/auto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {localView,linkCatalog,reconcile,resolveConflict,flush} from '../src/services/firebase/catalogLocal.ts'
import {openCatalogDatabase} from '../src/services/catalogDatabase.ts'
import {CatalogRepository} from '../src/services/catalogRepository.ts'
import {ClassificationRepository} from '../src/services/classificationRepository.ts'
import {deletionBlockers} from '../src/services/firebase/catalogDeletion.ts'
import {readData} from '../src/services/data/snapshot.ts'
import {syncStateSchema,type Payload,type RemoteRecord} from '../src/services/firebase/catalogModel.ts'
const now=new Date().toISOString()
const classification=(entity:'categories'|'families'|'ips'):Payload=>({entity,id:crypto.randomUUID(),name:crypto.randomUUID(),description:'',isActive:true,order:0,createdAt:now})
const rec=(payload:Payload):RemoteRecord=>({payload,revision:1,operationId:crypto.randomUUID()})
test('tombstones hide catalog, survive reload, preserve source rows and block restored backup uploads',async()=>{
 const name=crypto.randomUUID(),p=classification('categories'),key=`categories/${p.id}`,remote={[key]:rec(p)}
 await linkCatalog(await localView(name),remote,[{key,action:'download'}],'space','admin',true,name)
 remote[key]={...remote[key],revision:2,deleted:{at:now,by:'admin'}}
 await reconcile(remote,true,name)
 assert.equal((await new ClassificationRepository(name).snapshot()).categories.length,0)
 assert.equal((await readData(name)).categories.length,1)
 syncStateSchema.parse((await localView(name)).state)
 const restored=await parseBackup(await createBackup(await readData(name)))
 assert.equal(restored.data.catalogSync[0].baseline[key].deleted?.by,'admin')
 const db=await openCatalogDatabase(name),c=await db.get('categories',p.id);await db.put('categories',{...c!,name:'Restored old backup',isActive:true});db.close()
 await reconcile(remote,true,name)
 assert.equal(Object.keys((await localView(name)).state!.pending).length,0)
 assert.equal((await new ClassificationRepository(name).snapshot()).categories.length,0)
 await assert.rejects(resolveConflict(key,'local',remote,true,name),/definitiva/)
 const fresh=crypto.randomUUID();await linkCatalog(await localView(fresh),remote,[{key,action:'download'}],'space','admin',true,fresh)
 assert.equal((await new ClassificationRepository(fresh).snapshot()).categories.length,0)
 await assert.rejects(linkCatalog(await localView(crypto.randomUUID()),remote,[{key,action:'upload'}],'space','admin',true,crypto.randomUUID()),/eliminado/)
})
test('offline product edit meets deletion: pending change retained as conflict, never resent; historical stock retained',async()=>{
 const name=crypto.randomUUID(),c=classification('categories'),p:Payload={entity:'products',id:crypto.randomUUID(),name:'Product',description:'',createdAt:now,categoryId:c.id,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product'}
 const key=`products/${p.id}`,remote={[`categories/${c.id}`]:rec(c),[key]:rec(p)}
 await linkCatalog(await localView(name),remote,Object.keys(remote).map(key=>({key,action:'download'})),'space','admin',true,name)
 const db=await openCatalogDatabase(name),product=(await db.get('products',p.id))!;await db.put('products',{...product,name:'Offline edit',stock:7,averageCost:100});db.close()
 await reconcile(remote,true,name);const pending=(await localView(name)).state!.pending[key].id
 remote[key]={...remote[key],revision:2,deleted:{at:now,by:'another-admin'}}
 await reconcile(remote,true,name)
 const state=(await localView(name)).state!;assert.equal(state.pending[key].id,pending);assert.match(state.conflicts[key],/eliminado/)
 let calls=0;await flush({commit:async()=>{calls++;throw Error('must not send')}},name);assert.equal(calls,0)
 assert.equal((await new CatalogRepository(name).snapshot()).products.length,0)
 const stored=(await readData(name)).products[0];assert.equal(stored.stock,7);assert.equal(stored.averageCost,100);assert.equal(stored.name,'Offline edit')
 await resolveConflict(key,'remote',remote,true,name);assert.equal((await localView(name)).state!.pending[key],undefined)
 const data=await readData(name);assert.ok(deletionBlockers(data,'categories',c.id,{...remote,[key]:rec(p)},null).some(s=>s.includes('asociados')))
 assert.ok(deletionBlockers(data,'products',p.id,remote,{promotions:[{productIds:[p.id]}]}).some(s=>s.includes('promociones')))
})

test('history is not a deletion blocker; pending operations are retained and block deletion',async()=>{
 const name=crypto.randomUUID(),db=await openCatalogDatabase(name),p=classification('categories');db.close()
 const remote={[`categories/${p.id}`]:rec(p)}
 await linkCatalog(await localView(name),remote,[{key:`categories/${p.id}`,action:'download'}],'space','admin',true,name)
 const data=await readData(name)
 data.catalogSync[0].pending[`categories/${p.id}`]={id:crypto.randomUUID(),expectedRevision:1,payload:p}
 assert.ok(deletionBlockers(data,'categories',p.id,remote,null).some(s=>s.includes('pendientes')))
 assert.equal(data.catalogSync[0].pending[`categories/${p.id}`].expectedRevision,1)
 delete data.catalogSync[0].pending[`categories/${p.id}`]
 assert.equal(deletionBlockers(data,'categories',p.id,remote,null).length,0)
})
