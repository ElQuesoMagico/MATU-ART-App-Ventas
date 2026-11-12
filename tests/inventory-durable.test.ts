import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { project as catalogProject, keyOf } from '../src/services/firebase/catalogModel.ts'
import { inventoryView, linkInventory, enqueueInventory, receiveInventory, markInventoryAttempt, cancelInventoryConflict } from '../src/services/firebase/commercial/inventoryLocal.ts'
import { planInventory, type InventoryBalance, type InventoryReceipt } from '../src/services/firebase/commercial/inventoryProtocol.ts'
import { readData, snapshotToken } from '../src/services/data/snapshot.ts'
import { createBackup, parseBackup, restoreBackup, digest } from '../src/services/data/backup.ts'
import { canonical } from '../src/services/data/snapshot.ts'
import { unlinkCatalog } from '../src/services/firebase/catalogLocal.ts'
import { CatalogRepository } from '../src/services/catalogRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import type { CatalogProduct } from '../src/types/catalog.ts'

async function seed(name: string, id = crypto.randomUUID(), uid = 'a') {
  const db=await openCatalogDatabase(name),now=new Date().toISOString()
  const category={id:crypto.randomUUID(),name:'Stickers',isActive:true,order:0,createdAt:now,updatedAt:now,activeName:'stickers'}
  const p:CatalogProduct={id,name:'Producto',activeName:'producto',categoryId:category.id,categoryIds:[category.id],familyIds:[],ipIds:[],price:600,stock:77,lowStockThreshold:0,averageCost:100,lastKnownCost:100,estimatedUnitCost:150,averageCostIsProvisional:false,isArchived:false,isFavorite:false,createdAt:now,updatedAt:now,revision:1}
  await db.put('categories',category);await db.put('products',p)
  const payload=catalogProject('products',p),categoryPayload=catalogProject('categories',category)
  await db.put('catalogSync',{key:'catalog',workspaceId:'space',ownerUid:uid,deviceId:crypto.randomUUID(),canWrite:true,baseline:{[keyOf(payload)]:{payload,revision:1,operationId:crypto.randomUUID()},[keyOf(categoryPayload)]:{payload:categoryPayload,revision:1,operationId:crypto.randomUUID()}},pending:{},excluded:[],conflicts:{}})
  db.close();return p
}
async function link(name:string,id:string,action:'count'|'unknown'|'receive',remote:Record<string,InventoryBalance>={},uid='a') {
  await linkInventory([{productId:id,action,...(action==='count'?{quantity:10}:{})}],remote,(await inventoryView(name)).token,'space',uid,true,name)
}
function server() {
  let clock=1
  const balances:Record<string,InventoryBalance>={},receipts:InventoryReceipt[]=[]
  const rows: {receipt:InventoryReceipt;cursor:{seconds:number;nanoseconds:number;id:string}}[]=[]
  return {balances,rows,async drain(name:string,uid='a') {
    const state=(await inventoryView(name)).state!
    for(const op of state.operations.filter(op=>op.state==='pending')) {
      let receipt=receipts.find(r=>r.intent.operationId===op.intent.operationId)
      if(!receipt){receipt=planInventory(op.intent,balances[op.intent.productId]??null);receipts.push(receipt);balances[op.intent.productId]=receipt.after;rows.push({receipt,cursor:{seconds:clock++,nanoseconds:0,id:receipt.intent.operationId}})}
      await receiveInventory([{receipt,cursor:{seconds:clock,nanoseconds:0,id:''}}],uid,'space',name)
    }
  }}
}
test('explicit opening never uploads previous stock/costs; durable count/adjustment/restock reach a second database exactly once',async()=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),p=await seed(a),s=server()
  await link(a,p.id,'count');let local=await inventoryView(a)
  assert.equal(local.state!.originals[p.id].stock,77);assert.equal(local.state!.originals[p.id].averageCost,100)
  assert.equal(local.products[0].stock,10);assert.equal(local.products[0].averageCost,undefined)
  assert.equal(local.state!.operations.length,2)
  await s.drain(a);await seed(b,p.id,'b');await link(b,p.id,'receive',s.balances,'b');await receiveInventory(s.rows,'b','space',b)
  let db=await openCatalogDatabase(b);assert.equal((await db.getAll('movements')).length,2);db.close()
  const input={id:crypto.randomUUID(),productId:p.id,type:'adjustment' as const,quantity:-2,expectedRevision:(await inventoryView(b)).products[0].revision}
  await enqueueInventory(input,'b','space',b);await enqueueInventory(input,'b','space',b)
  // All repository connections close after each operation: simulate reopening without an in-memory queue.
  assert.equal((await inventoryView(b)).state!.operations.length,1)
  await s.drain(b,'b');await receiveInventory(s.rows,'a','space',a)
  assert.equal((await inventoryView(a)).products[0].stock,8)
  await enqueueInventory({id:crypto.randomUUID(),productId:p.id,type:'restock',quantity:3,unitCost:0,expectedRevision:(await inventoryView(a)).products[0].revision},'a','space',a)
  await s.drain(a);await receiveInventory(s.rows,'b','space',b);await receiveInventory(s.rows,'b','space',b)
  local=await inventoryView(b);assert.equal(local.products[0].stock,11);assert.equal(local.products[0].lastKnownCost,0)
  db=await openCatalogDatabase(b);assert.equal((await db.getAll('movements')).length,4);db.close()
})
test('unknown is not zero; stale preview and malformed count roll back the complete incorporation',async()=>{
  const name=crypto.randomUUID(),p=await seed(name),before=await inventoryView(name)
  await assert.rejects(()=>linkInventory([{productId:p.id,action:'count'}],{},before.token,'space','a',true,name))
  assert.equal((await inventoryView(name)).token,before.token)
  await link(name,p.id,'unknown');assert.equal((await inventoryView(name)).products[0].stockCountPending,true)
  await assert.rejects(()=>linkInventory([{productId:p.id,action:'unknown'}],{},before.token,'space','a',true,name),/cambiaron/)
  await enqueueInventory({id:crypto.randomUUID(),productId:p.id,type:'count',quantity:0,expectedRevision:(await inventoryView(name)).products[0].revision},'a','space',name)
  assert.equal((await inventoryView(name)).products[0].stockCountPending,false)
  assert.equal((await inventoryView(name)).products[0].inventoryPending,true)
})
test('concurrent operation preserves conflict and original movement; review never resubmits it under a new ID',async()=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),p=await seed(a),s=server()
  await link(a,p.id,'count');await s.drain(a);await seed(b,p.id,'b');await link(b,p.id,'receive',s.balances,'b')
  const qa=crypto.randomUUID(),qb=crypto.randomUUID()
  await enqueueInventory({id:qa,productId:p.id,type:'adjustment',quantity:-2,expectedRevision:(await inventoryView(a)).products[0].revision},'a','space',a)
  await enqueueInventory({id:qb,productId:p.id,type:'adjustment',quantity:-3,expectedRevision:(await inventoryView(b)).products[0].revision},'b','space',b)
  await s.drain(a);await receiveInventory(s.rows,'b','space',b)
  const conflict=(await inventoryView(b)).state!.operations[0]
  assert.equal(conflict.state,'conflict');assert.equal(conflict.intent.operationId,qb)
  await cancelInventoryConflict(qb,'b',b)
  assert.equal((await inventoryView(b)).products[0].stock,8)
  const db=await openCatalogDatabase(b);assert.equal((await db.get('movements',qb))!.sharedStatus,'cancelled');db.close()
})
test('backup preserves pending UUIDs and restores into an empty profile; cannot replace an already linked queue',async()=>{
  const name=crypto.randomUUID(),p=await seed(name);await link(name,p.id,'count')
  const data=await readData(name),backup=await createBackup(data),parsed=await parseBackup(backup)
  assert.deepEqual(parsed.data.inventorySync,data.inventorySync)
  const target=crypto.randomUUID(),empty=await readData(target)
  await restoreBackup(parsed.data,snapshotToken(empty),target)
  assert.deepEqual((await inventoryView(target)).state!.operations,(await inventoryView(name)).state!.operations)
  await assert.rejects(()=>restoreBackup(parsed.data,snapshotToken(data),name),/Inventario compartido/)
})
test('errors retain pending UUID and attempts; another account cannot enqueue or acknowledge',async()=>{
  const name=crypto.randomUUID(),p=await seed(name);await link(name,p.id,'count')
  const op=(await inventoryView(name)).state!.operations[0]
  await markInventoryAttempt(op.intent.operationId,'a','Sin red',false,name)
  const reopened=(await inventoryView(name)).state!.operations[0]
  assert.equal(reopened.intent.operationId,op.intent.operationId);assert.equal(reopened.state,'pending');assert.equal(reopened.attempts,1)
  await assert.rejects(()=>enqueueInventory({id:crypto.randomUUID(),productId:p.id,type:'count',quantity:1,expectedRevision:1},'other','space',name),/autorización/)
})
test('local sales and direct stock writes cannot bypass D2 guard; ordinary catalog remains editable',async()=>{
  const name=crypto.randomUUID(),p=await seed(name);await link(name,p.id,'count')
  const current=(await inventoryView(name)).products[0],repo=new CatalogRepository(name),sales=new SalesRepository(name)
  try {
    await assert.rejects(()=>repo.recordMovement({id:crypto.randomUUID(),productId:p.id,type:'adjustment',quantity:1,expectedRevision:current.revision}),/compartido/)
    await assert.rejects(()=>sales.confirm({operationId:crypto.randomUUID(),items:[{productId:p.id,quantity:1,unitPrice:600,expectedRevision:current.revision}],payments:[{method:'cash',amount:600}]}),/inventario compartido/)
  } finally {await repo.close();await sales.close()}
})
test('v11 migration is additive and leaves historic stock and UUID untouched',async()=>{
  const name=crypto.randomUUID(),p=await seed(name)
  // Minimal v11 fixture verifies the new store is additive and products are untouched.
  const source=await openCatalogDatabase(name),rows=await source.getAll('products');source.close()
  const oldName=crypto.randomUUID(),old=await openDB(oldName,11,{upgrade(db){db.createObjectStore('products',{keyPath:'id'})}})
  for(const row of rows)await old.put('products',row);old.close()
  const upgraded=await openCatalogDatabase(oldName)
  assert.equal(upgraded.version,13);assert.equal((await upgraded.get('products',p.id))!.stock,77)
  assert.equal((await upgraded.getAll('inventorySync')).length,0);upgraded.close()
})
test('v11 backups adapt without deleting values; linked inventory prevents catalog unlink',async()=>{
  const empty=await readData(crypto.randomUUID()),raw=JSON.parse(await createBackup(empty))
  raw.databaseVersion=11;delete raw.data.inventorySync;delete raw.counts.inventorySync;delete raw.data.commercialSync;delete raw.counts.commercialSync
  const {sha256:_old,...body}=raw;raw.sha256=await digest(canonical(body))
  const parsed=await parseBackup(JSON.stringify(raw))
  assert.deepEqual(parsed.data.inventorySync,[]);assert.deepEqual(parsed.data.expenseCategories,empty.expenseCategories)
  const name=crypto.randomUUID(),p=await seed(name);await link(name,p.id,'unknown')
  await assert.rejects(()=>unlinkCatalog(name),/inventario compartido/)
})
