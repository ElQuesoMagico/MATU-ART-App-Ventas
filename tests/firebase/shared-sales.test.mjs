import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { saleRemote } from '../../src/services/firebase/commercial/saleRemote.ts'
import { planSharedSale } from '../../src/services/firebase/commercial/saleProtocol.ts'
let env
const workspace='shared-sales', root=`workspaces/${workspace}`
before(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw new Error('Local emulator required')
  env=await initializeTestEnvironment({projectId:'demo-matu-shared-sales',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../../firestore.commercial.rules',import.meta.url),'utf8')}})
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async c=>{ for(const [uid,role] of [['a','administrator'],['b','seller']])await setDoc(doc(c.firestore(),`${root}/members/${uid}`),{enabled:true,role}) })
})
after(async()=>{await env?.cleanup()})
async function fixture(count=1){
  const balances={}, now=new Date().toISOString(), saleId=crypto.randomUUID()
  const items=Array.from({length:count},()=>{const id=crypto.randomUUID();balances[id]={productId:id,stock:10,countPending:false,revision:1,operationId:crypto.randomUUID(),costs:{averageCost:null,lastKnownCost:null,estimatedUnitCost:null,averageCostIsProvisional:true}};return{productId:id,name:'Sticker',categoryIds:[],quantity:2,unitPrice:600,lineTotal:1200,cost:{source:'unknown',isProvisional:false},stock:{quantitySold:2,previousStock:10,quantityDeducted:2,resultingStock:8,uncoveredQuantity:0}}})
  await env.withSecurityRulesDisabled(async c=>{for(const [id,balance] of Object.entries(balances))await setDoc(doc(c.firestore(),`${root}/inventory/${id}`),{balance,confirmedAt:serverTimestamp()})})
  return{balances,intent:{schemaVersion:1,actorUid:'a',deviceId:crypto.randomUUID(),sale:{id:saleId,operationId:crypto.randomUUID(),operationFingerprint:'fixture',number:1,soldAt:now,createdAt:now,items,subtotal:1200*count,discount:0,total:1200*count,status:'completed',stockDifferences:[],movementIds:items.map(()=>crypto.randomUUID()),payments:[{id:crypto.randomUUID(),saleId,createdAt:now,method:'cash',amount:1200*count}]}}}
}
test('atomic shared sale and retry preserve payments and inventory; two concurrent sales accumulate',async()=>{
  const {intent}=await fixture(),a=env.authenticatedContext('a').firestore(),b=env.authenticatedContext('b').firestore(),A=saleRemote(a,workspace,'a'),B=saleRemote(b,workspace,'b')
  const second=structuredClone(intent);second.actorUid='b';second.sale.id=crypto.randomUUID();second.sale.operationId=crypto.randomUUID();second.sale.movementIds=[crypto.randomUUID()];second.sale.payments[0].id=crypto.randomUUID();second.sale.payments[0].saleId=second.sale.id
  second.sale.items[0].quantity=3;second.sale.items[0].lineTotal=1800;second.sale.subtotal=second.sale.total=second.sale.payments[0].amount=1800
  const [one,two]=await Promise.all([A.commitSale(intent),B.commitSale(second)])
  assert.equal((await getDoc(doc(a,`${root}/inventory/${intent.sale.items[0].productId}`))).data().balance.stock,5)
  assert.deepEqual(await A.commitSale(intent),one);assert.deepEqual(await B.commitSale(second),two)
  assert.equal((await A.confirmed(intent.sale.operationId)).operation.receipt.sale.total,1200)
  const voidIntent={schemaVersion:1,operationId:crypto.randomUUID(),saleId:one.receipt.sale.id,actorUid:'a',deviceId:intent.deviceId,occurredAt:new Date().toISOString(),reason:'Error',returnStock:true,movementIds:[crypto.randomUUID()]}
  const cancelled=await A.commitVoid(voidIntent).catch(e=>{throw new Error("void: "+e.message)});assert.equal(Object.values(cancelled.receipt.after)[0].stock,7)
  assert.deepEqual(await A.commitVoid(voidIntent),cancelled)
  await assert.rejects(()=>A.commitVoid({...voidIntent,operationId:crypto.randomUUID()}),/anulada/)
})
test('maximum supported atomic sale fits Firestore rule limits',async()=>{
  const {intent}=await fixture(5),db=env.authenticatedContext('a').firestore()
  const receipt=await saleRemote(db,workspace,'a').commitSale(intent)
  assert.equal(receipt.receipt.movements.length,5)
  const cancelled=await saleRemote(db,workspace,'a').commitVoid({schemaVersion:1,operationId:crypto.randomUUID(),saleId:intent.sale.id,actorUid:'a',deviceId:intent.deviceId,occurredAt:new Date().toISOString(),reason:'Revisión de cinco líneas',returnStock:true,movementIds:intent.sale.items.map(()=>crypto.randomUUID())})
  assert.equal(cancelled.receipt.movements.length,5)
  assert.ok(Object.values(cancelled.receipt.after).every(balance=>balance.stock===10))
})
test('rules reject receipt without stock effects, direct stock, payment mutation, unauthorized void and anonymous sale',async()=>{
  const {intent,balances}=await fixture(),db=env.authenticatedContext('a').firestore(),receipt=planSharedSale(intent,balances)
  await assertFails(setDoc(doc(db,`${root}/saleOperations/${intent.sale.operationId}`),{kind:'sale',receipt:JSON.parse(JSON.stringify(receipt)),confirmedAt:serverTimestamp()}))
  await assertFails(updateDoc(doc(db,`${root}/inventory/${intent.sale.items[0].productId}`),{'balance.stock':999}))
  await assertFails(saleRemote(env.unauthenticatedContext().firestore(),workspace,'a').commitSale(intent))
  await saleRemote(db,workspace,'a').commitSale(intent)
  await assertFails(updateDoc(doc(db,`${root}/sharedSales/${intent.sale.id}`),{'sale.total':0}))
  const voidIntent={schemaVersion:1,operationId:crypto.randomUUID(),saleId:intent.sale.id,actorUid:'b',deviceId:intent.deviceId,occurredAt:new Date().toISOString(),reason:'Error',returnStock:false,movementIds:[]}
  await assertFails(saleRemote(env.authenticatedContext('b').firestore(),workspace,'b').commitVoid(voidIntent))
  const another=await fixture(),forged=planSharedSale(another.intent,another.balances);forged.sale.payments[0].amount=1
  const batch=writeBatch(db);batch.set(doc(db,`${root}/saleOperations/${another.intent.sale.operationId}`),{kind:'sale',receipt:JSON.parse(JSON.stringify(forged)),confirmedAt:serverTimestamp()})
  batch.set(doc(db,`${root}/sharedSales/${another.intent.sale.id}`),{sale:forged.sale,operationId:another.intent.sale.operationId,actorUid:'a',deviceId:another.intent.deviceId,confirmedAt:serverTimestamp()})
  for(const[id,balance]of Object.entries(forged.after))batch.set(doc(db,`${root}/inventory/${id}`),{balance,confirmedAt:serverTimestamp()})
  await assertFails(batch.commit())
})
