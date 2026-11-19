import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing'
import {doc,setDoc,getDoc,updateDoc,deleteDoc} from 'firebase/firestore'
import {catalogRemote} from '../../src/services/firebase/catalogRemote.ts'
import {stable} from '../../src/services/firebase/catalogModel.ts'
let env,A,B,S
const w='deletion-test',device=crypto.randomUUID()
const payload=(entity='categories')=>({id:crypto.randomUUID(),entity,name:crypto.randomUUID(),description:'',createdAt:new Date().toISOString(),isActive:true,order:0})
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-matu-deletions',firestore:{host:'127.0.0.1',port:8080,rules:await readFile('firestore.commercial.rules','utf8')}});await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{for(const [u,role] of [['a','administrator'],['b','manager'],['s','seller']])await setDoc(doc(c.firestore(),`workspaces/${w}/members/${u}`),{role,enabled:true})});A=catalogRemote(env.authenticatedContext('a').firestore(),w,'a');B=catalogRemote(env.authenticatedContext('b').firestore(),w,'b');S=catalogRemote(env.authenticatedContext('s').firestore(),w,'s')})
after(async()=>env?.cleanup())
async function remove(p,who=A,operation=crypto.randomUUID()){const snapshot=await who.deletionSnapshot();const key=`${p.entity}/${p.id}`;return who.remove(key,snapshot.records[key].revision,snapshot.epoch,operation,device,stable(snapshot.configuration))}
test('empty classifications have immutable tombstones, idempotent receipts and cannot resurrect',async()=>{
 for(const entity of ['categories','families','ips']){
  const p=payload(entity);await A.commit({id:crypto.randomUUID(),payload:p,expectedRevision:0},device)
  const snap=await A.deletionSnapshot(),key=`${entity}/${p.id}`,op=crypto.randomUUID()
  const result=await A.remove(key,1,snap.epoch,op,device,stable(snap.configuration));assert.equal(result.deleted.by,'a')
  assert.deepEqual(await A.remove(key,1,snap.epoch,op,device,stable(snap.configuration)),result)
  assert.equal((await B.read())[key].revision,2)
  await assert.rejects(B.commit({id:crypto.randomUUID(),payload:p,expectedRevision:2},device),/eliminado/)
  const db=env.authenticatedContext('a').firestore();await assertFails(deleteDoc(doc(db,`workspaces/${w}/${key}`)));await assertFails(updateDoc(doc(db,`workspaces/${w}/${key}`),{deleted:null}));await assertFails(updateDoc(doc(db,`workspaces/${w}/catalogOperations/${op}`),{actorUid:'b'}))
 }
})
test('concurrent catalog edit invalidates preview and seller cannot delete',async()=>{
 const p=payload();await A.commit({id:crypto.randomUUID(),payload:p,expectedRevision:0},device);const snap=await A.deletionSnapshot()
 await B.commit({id:crypto.randomUUID(),payload:{...p,name:'Changed '+p.name},expectedRevision:1},device)
 await assert.rejects(A.remove(`categories/${p.id}`,1,snap.epoch,crypto.randomUUID(),device,stable(snap.configuration)),/cambió/)
 await assertFails(remove({...p,name:'Changed '+p.name},S))
})
test('product deletion keeps historical data and rejects existing stock',async()=>{
 const c=payload();await A.commit({id:crypto.randomUUID(),payload:c,expectedRevision:0},device)
 const p={id:crypto.randomUUID(),entity:'products',name:crypto.randomUUID(),description:'',createdAt:new Date().toISOString(),categoryId:c.id,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product'}
 await A.commit({id:crypto.randomUUID(),payload:p,expectedRevision:0},device)
 await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),`workspaces/${w}/inventory/${p.id}`),{balance:{stock:3,productId:p.id}});await setDoc(doc(ctx.firestore(),`workspaces/${w}/sharedSales/history`),{sale:{items:[{productId:p.id,name:p.name,unitPrice:600}]}})})
 await assert.rejects(remove(p),/existencias/)
 await env.withSecurityRulesDisabled(async ctx=>updateDoc(doc(ctx.firestore(),`workspaces/${w}/inventory/${p.id}`),{'balance.stock':0}))
 await remove(p)
 const db=env.authenticatedContext('a').firestore();assert.equal((await getDoc(doc(db,`workspaces/${w}/inventory/${p.id}`))).data().deleted,true)
 assert.equal((await getDoc(doc(db,`workspaces/${w}/sharedSales/history`))).data().sale.items[0].unitPrice,600)
})

test('classification cannot be deleted before explicit reassignment; stale offline references rejected',async()=>{
 const c=payload(),target=payload();await A.commit({id:crypto.randomUUID(),payload:c,expectedRevision:0},device);await A.commit({id:crypto.randomUUID(),payload:target,expectedRevision:0},device)
 const p={id:crypto.randomUUID(),entity:'products',name:crypto.randomUUID(),description:'',createdAt:new Date().toISOString(),categoryId:c.id,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product'}
 await A.commit({id:crypto.randomUUID(),payload:p,expectedRevision:0},device)
 await assert.rejects(remove(c),/asociados/)
 await B.commit({id:crypto.randomUUID(),payload:{...p,categoryId:target.id},expectedRevision:1},device)
 await remove(c)
 await assertFails(B.commit({id:crypto.randomUUID(),payload:p,expectedRevision:2},device))
})

test('void of historical sale retains tombstone, payments and compensated inventory; new sales rejected',async()=>{
 const {saleRemote}=await import('../../src/services/firebase/commercial/saleRemote.ts')
 const c=payload();await A.commit({id:crypto.randomUUID(),payload:c,expectedRevision:0},device)
 const p={id:crypto.randomUUID(),entity:'products',name:crypto.randomUUID(),description:'',createdAt:new Date().toISOString(),categoryId:c.id,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product'}
 await A.commit({id:crypto.randomUUID(),payload:p,expectedRevision:0},device)
 const now=new Date().toISOString(),saleId=crypto.randomUUID(),balance={productId:p.id,stock:2,countPending:false,revision:1,operationId:crypto.randomUUID(),costs:{averageCost:null,lastKnownCost:null,estimatedUnitCost:null,averageCostIsProvisional:true}}
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),`workspaces/${w}/inventory/${p.id}`),{balance}))
 const item={productId:p.id,name:p.name,categoryIds:[c.id],quantity:2,unitPrice:600,lineTotal:1200,cost:{source:'unknown',isProvisional:false},stock:{quantitySold:2,previousStock:2,quantityDeducted:2,resultingStock:0,uncoveredQuantity:0}}
 const intent={schemaVersion:1,actorUid:'a',deviceId:device,sale:{id:saleId,operationId:crypto.randomUUID(),operationFingerprint:'test',number:1,soldAt:now,createdAt:now,items:[item],subtotal:1200,discount:0,total:1200,status:'completed',stockDifferences:[],movementIds:[crypto.randomUUID()],payments:[{id:crypto.randomUUID(),saleId,createdAt:now,method:'cash',amount:1200}]}}
 const db=env.authenticatedContext('a').firestore(),sales=saleRemote(db,w,'a')
 await sales.commitSale(intent);await remove(p)
 const cancelled=await sales.commitVoid({schemaVersion:1,operationId:crypto.randomUUID(),saleId,actorUid:'a',deviceId:device,occurredAt:now,reason:'Test only emulator',returnStock:true,movementIds:[crypto.randomUUID()]})
 assert.equal(cancelled.receipt.sale.payments[0].amount,1200)
 const saved=(await getDoc(doc(db,`workspaces/${w}/inventory/${p.id}`))).data();assert.equal(saved.deleted,true);assert.equal(saved.balance.stock,2)
 const next=structuredClone(intent);next.sale.id=crypto.randomUUID();next.sale.operationId=crypto.randomUUID();next.sale.payments[0].saleId=next.sale.id
 await assert.rejects(sales.commitSale(next),/eliminado/)
})

test('offline listener receives terminal deletion after reconnect without restoring row',async()=>{
 const p=payload('families');await A.commit({id:crypto.randomUUID(),payload:p,expectedRevision:0},device)
 const db=env.authenticatedContext('b').firestore(),reader=catalogRemote(db,w,'b');let latest={},failure
 const stop=reader.watch(rows=>{latest=rows},e=>{failure=e})
 async function until(check){const end=Date.now()+10000;while(!check()){if(failure)throw failure;if(Date.now()>end)throw Error('listener timeout');await new Promise(r=>setTimeout(r,20))}}
 try{await until(()=>latest[`families/${p.id}`]);await db.disableNetwork();await remove(p);assert.equal(latest[`families/${p.id}`].deleted,undefined);await db.enableNetwork();await until(()=>latest[`families/${p.id}`]?.deleted);assert.equal(latest[`families/${p.id}`].revision,2)}finally{stop();await db.terminate()}
})
