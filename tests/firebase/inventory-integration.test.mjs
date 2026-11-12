import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { openCatalogDatabase } from '../../src/services/catalogDatabase.ts'
import { inventoryRemote } from '../../src/services/firebase/commercial/inventoryRemote.ts'
import { inventoryView, linkInventory, enqueueInventory, receiveInventory } from '../../src/services/firebase/commercial/inventoryLocal.ts'
import { project, keyOf } from '../../src/services/firebase/catalogModel.ts'

let env, adb, bdb
const id=crypto.randomUUID()
const workspace='d2-integration'
before(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw new Error('Local emulator required')
  env=await initializeTestEnvironment({projectId:'demo-matu-d2-integrated',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../../firestore.inventory.rules',import.meta.url),'utf8')}})
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async c=>{for(const uid of ['a','b'])await setDoc(doc(c.firestore(),`workspaces/${workspace}/members/${uid}`),{role:'administrator',enabled:true})})
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`workspaces/${workspace}/products/${id}`),{payload:{id,isArchived:false}}))
  adb=env.authenticatedContext('a').firestore();bdb=env.authenticatedContext('b').firestore()
  await import('fake-indexeddb/auto')
})
after(async()=>{await env?.cleanup()}, {timeout:5000})
async function local(name,id,uid){
  const db=await openCatalogDatabase(name),now=new Date().toISOString()
  const category={id:crypto.randomUUID(),name:'Prueba aislada',isActive:true,order:0,createdAt:now,updatedAt:now}
  const p={id,name:'Solo emulador D2',activeName:'solo emulador d2',categoryId:category.id,categoryIds:[category.id],familyIds:[],ipIds:[],stock:777,price:600,lowStockThreshold:0,averageCostIsProvisional:true,isArchived:false,isFavorite:false,revision:1,createdAt:now,updatedAt:now}
  const payload=project('products',p)
  await db.put('categories',category);await db.put('products',p)
  await db.put('catalogSync',{key:'catalog',workspaceId:workspace,ownerUid:uid,deviceId:crypto.randomUUID(),canWrite:true,baseline:{[keyOf(payload)]:{payload,revision:1,operationId:crypto.randomUUID()}},pending:{},excluded:[],conflicts:{}})
  db.close();return p
}
async function drain(name,uid,remote){
  for(const op of (await inventoryView(name)).state.operations.filter(o=>o.state==='pending')){
    await remote.commit(op.intent)
    await receiveInventory([await remote.confirmed(op.intent.operationId)],uid,workspace,name)
  }
}
function receiver(name,uid,remote){
  let active=true,failure
  const subscriptions=new Set(),work=new Set()
  async function listen(){
    const cursor=(await inventoryView(name)).state.cursor
    if(!active)return
    let consumed=false
    const stop=remote.watchPage(cursor,rows=>{
      if(!active||consumed)return
      consumed=true;stop();subscriptions.delete(stop)
      const next=receiveInventory(rows,uid,workspace,name).then(listen).catch(error=>{failure=error})
      work.add(next);void next.finally(()=>work.delete(next))
    },error=>{failure=error})
    subscriptions.add(stop)
  }
  const initial=listen();work.add(initial);void initial.finally(()=>work.delete(initial))
  return {async close(){active=false;for(const stop of subscriptions)stop();await Promise.all(work)},async until(predicate){const deadline=Date.now()+10000;while(!predicate(await inventoryView(name))){if(failure)throw failure;if(Date.now()>deadline)throw new Error('Receive timeout');await new Promise(r=>setTimeout(r,20))}}}
}
test('two isolated IndexedDB devices share stock and history through real emulator listeners, recover lost ACK and reconnect',async()=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID()
  await local(a,id,'a');await local(b,id,'b')
  const A=inventoryRemote(adb,workspace,'a'),B=inventoryRemote(bdb,workspace,'b')
  await linkInventory([{productId:id,action:'count',quantity:10}],{},(await inventoryView(a)).token,workspace,'a',true,a)
  // Commit succeeds, but browser closes before writing the local ACK.
  const opening=(await inventoryView(a)).state.operations[0]
  await A.commit(opening.intent)
  await drain(a,'a',A)
  const remote=await B.read()
  await linkInventory([{productId:id,action:'receive'}],remote,(await inventoryView(b)).token,workspace,'b',true,b)
  const listenA=receiver(a,'a',A),listenB=receiver(b,'b',B)
  try{
    await listenB.until(v=>v.state.cursor!==undefined)
    await enqueueInventory({id:crypto.randomUUID(),productId:id,type:'adjustment',quantity:-2,expectedRevision:(await inventoryView(b)).products[0].revision},'b',workspace,b)
    await drain(b,'b',B);await listenA.until(v=>v.products[0].stock===8)
    await bdb.disableNetwork()
    const operationId=crypto.randomUUID()
    await enqueueInventory({id:operationId,productId:id,type:'restock',quantity:3,unitCost:0,expectedRevision:(await inventoryView(b)).products[0].revision},'b',workspace,b)
    const reopened=await inventoryView(b)
    assert.equal(reopened.state.operations.find(o=>o.intent.operationId===operationId).state,'pending')
    assert.equal((await inventoryView(a)).products[0].stock,8)
    await bdb.enableNetwork();await drain(b,'b',B)
    await listenA.until(v=>v.products[0].stock===11)
    await drain(b,'b',B)
    const dbA=await openCatalogDatabase(a),dbB=await openCatalogDatabase(b)
    assert.equal(await dbA.count('movements'),4);assert.equal(await dbB.count('movements'),4)
    assert.equal((await dbA.get('movements',operationId)).sharedStatus,'confirmed')
    assert.equal((await dbB.get('movements',operationId)).sharedStatus,'confirmed')
    dbA.close();dbB.close()
  }finally{await Promise.all([listenA.close(),listenB.close()]);await bdb.enableNetwork();await Promise.all([adb.terminate(),bdb.terminate()]);await env.cleanup()}
})
