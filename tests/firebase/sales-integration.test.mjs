import { before,after,test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc,setDoc } from 'firebase/firestore'
import { openCatalogDatabase } from '../../src/services/catalogDatabase.ts'
import { commercialView,linkCommercial,receiveConfiguration,receiveSales } from '../../src/services/firebase/commercial/commercialLocal.ts'
import { configurationRemote } from '../../src/services/firebase/commercial/configurationRemote.ts'
import { saleRemote } from '../../src/services/firebase/commercial/saleRemote.ts'
import { SalesRepository } from '../../src/services/salesRepository.ts'
import { readData } from '../../src/services/data/snapshot.ts'
import { createBackup } from '../../src/services/data/backup.ts'
let env,adb,bdb
const workspace='sales-integration',productId=crypto.randomUUID(),categoryId=crypto.randomUUID()
const balance={productId,stock:10,countPending:false,revision:1,operationId:crypto.randomUUID(),costs:{averageCost:0,lastKnownCost:0,estimatedUnitCost:null,averageCostIsProvisional:false}}
before(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw new Error('Local emulator required')
  env=await initializeTestEnvironment({projectId:'demo-matu-sales-integrated',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../../firestore.commercial.rules',import.meta.url),'utf8')}})
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async c=>{
    for(const uid of['a','b'])await setDoc(doc(c.firestore(),`workspaces/${workspace}/members/${uid}`),{role:'administrator',enabled:true})
    await setDoc(doc(c.firestore(),`workspaces/${workspace}/inventory/${productId}`),{balance})
  })
  adb=env.authenticatedContext('a').firestore();bdb=env.authenticatedContext('b').firestore();await import('fake-indexeddb/auto')
})
after(async()=>{await env?.cleanup()})
async function local(name,uid){
  const db=await openCatalogDatabase(name),now=new Date().toISOString(),deviceId=crypto.randomUUID()
  await db.put('categories',{id:categoryId,name:'Stickers',isActive:true,order:0,createdAt:now,updatedAt:now})
  await db.put('products',{id:productId,name:'Sticker',activeName:'sticker',categoryId,categoryIds:[categoryId],familyIds:[],ipIds:[],stock:10,price:600,lowStockThreshold:0,averageCost:0,lastKnownCost:0,averageCostIsProvisional:false,inventoryShared:true,isArchived:false,isFavorite:false,revision:1,createdAt:now,updatedAt:now})
  await db.put('catalogSync',{key:'catalog',ownerUid:uid,workspaceId:workspace,deviceId,canWrite:true,baseline:{},pending:{},conflicts:{},excluded:[]})
  await db.put('inventorySync',{key:'inventory',ownerUid:uid,workspaceId:workspace,deviceId,canWrite:true,products:[productId],baseline:{[productId]:balance},originals:{},operations:[]});db.close()
}
async function sell(name,uid,quantity){
  const data=await readData(name),repo=new SalesRepository(name)
  try{return await repo.confirm({operationId:crypto.randomUUID(),items:[{productId,quantity,unitPrice:600,expectedRevision:data.products[0].revision}],payments:[{method:'cash',amount:quantity*200},{method:'debit',amount:quantity*400}]},{uid,workspaceId:workspace})}finally{await repo.close()}
}
async function drain(name,uid,remote){for(const op of(await commercialView(name)).state.operations.filter(o=>o.state==='pending')){if(op.kind==='sale')await remote.commitSale(op.intent);else await remote.commitVoid(op.intent);const id=op.kind==='sale'?op.intent.sale.operationId:op.intent.operationId;await receiveSales([await remote.confirmed(id)],uid,workspace,name)}}
function receiver(name,uid,remote){
  let active=true,failure;const subscriptions=new Set(),work=new Set()
  async function listen(){const state=(await commercialView(name)).state;if(!active)return;let consumed=false;const stop=remote.watchPage(state.cursor,rows=>{if(!active||consumed)return;consumed=true;stop();subscriptions.delete(stop);const next=receiveSales(rows,uid,workspace,name).then(listen).catch(e=>{failure=e});work.add(next);void next.finally(()=>work.delete(next))},e=>{failure=e});subscriptions.add(stop)}
  const first=listen();work.add(first);void first.finally(()=>work.delete(first))
  return{async close(){active=false;for(const stop of subscriptions)stop();await Promise.all(work)},async until(predicate){const deadline=Date.now()+10000;while(!predicate(await readData(name))){if(failure)throw failure;if(Date.now()>deadline)throw new Error('Listener timeout');await new Promise(r=>setTimeout(r,20))}}}
}
test('two durable devices: shared sales, lost ACK, offline restart, automatic receipt, void and backup integrity',async()=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID();await local(a,'a');await local(b,'b')
  await linkCommercial((await commercialView(a)).token,null,'local','a',workspace,true,a)
  const pending=(await commercialView(a)).state.configurationPending,remoteConfig=await configurationRemote(adb,workspace,'a').commit(pending)
  await receiveConfiguration(remoteConfig,'a',a);await linkCommercial((await commercialView(b)).token,remoteConfig,'remote','b',workspace,true,b)
  const A=saleRemote(adb,workspace,'a'),B=saleRemote(bdb,workspace,'b'),listenA=receiver(a,'a',A),listenB=receiver(b,'b',B)
  try{
    const first=await sell(a,'a',2),op=(await commercialView(a)).state.operations[0]
    await A.commitSale(op.intent) // Simulate a lost local ACK; durable replay must use the same UUID.
    await drain(a,'a',A);await listenB.until(d=>d.sales.length===1&&d.products[0].stock===8)
    await bdb.disableNetwork();const offline=await sell(b,'b',3)
    assert.equal((await commercialView(b)).state.operations.find(o=>o.intent.sale?.id===offline.id).state,'pending')
    await sell(a,'a',1);await drain(a,'a',A)
    await bdb.enableNetwork();await drain(b,'b',B)
    await listenA.until(d=>d.sales.length===3&&d.products[0].stock===4);await listenB.until(d=>d.sales.length===3&&d.products[0].stock===4)
    const repo=new SalesRepository(b);await repo.voidSale({saleId:first.id,operationId:crypto.randomUUID(),reason:'Error de cobro',returnStock:true},{uid:'b',workspaceId:workspace});await repo.close()
    await drain(b,'b',B);await listenA.until(d=>d.sales.find(s=>s.id===first.id)?.status==='voided'&&d.products[0].stock===6)
    await drain(b,'b',B)
    for(const name of[a,b]){const d=await readData(name);assert.equal(d.sales.length,3);assert.equal(d.payments.length,6);assert.equal(d.movements.length,4);assert.equal(d.sales.find(s=>s.id===first.id).sharedActorUid,'a');assert.equal(d.sales.find(s=>s.id===first.id).voidActorUid,'b');await createBackup(d)}
  }finally{await Promise.all([listenA.close(),listenB.close()]);await bdb.enableNetwork();await Promise.all([adb.terminate(),bdb.terminate()])}
})
