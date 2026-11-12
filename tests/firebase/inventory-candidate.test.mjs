import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { inventoryRemote } from '../../src/services/firebase/commercial/inventoryRemote.ts'
import { planInventory } from '../../src/services/firebase/commercial/inventoryProtocol.ts'
let env
const root = 'workspaces/inventory-candidate'
const make = (productId, overrides = {}) => ({ schemaVersion: 1, operationId: crypto.randomUUID(), productId,
  deviceId: crypto.randomUUID(), actorUid: 'a', occurredAt: new Date().toISOString(), expectedRevision: 0,
  type: 'initialize', quantity: 0, unitCost: null, reason: '', ...overrides })
before(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local emulator required')
  const base = await readFile(new URL('../../firestore.catalog.rules', import.meta.url), 'utf8')
  const fragment = await readFile(new URL('./fixtures/inventory.rules.fragment', import.meta.url), 'utf8')
  const combined = base.replace('match /workspaces/{w} {', `match /workspaces/{w} {\n${fragment}`)
  assert.equal(await readFile(new URL('../../firestore.inventory.rules', import.meta.url),'utf8'),combined,'Deployment rules must match tested rules')
  env = await initializeTestEnvironment({ projectId: 'demo-matu-inventory-candidate', firestore: {
    host: '127.0.0.1', port: 8080, rules: combined,
  } })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, role] of [['a','administrator'],['b','manager'],['s','seller']]) await setDoc(doc(context.firestore(), `${root}/members/${uid}`), { role, enabled: true })
  })
})
after(async () => { await env?.cleanup() })
async function product() {
  const id = crypto.randomUUID()
  await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), `${root}/products/${id}`), { payload: { id, isArchived: false } }) })
  return id
}
test('two sessions receive count and restock automatically; idempotent receipt survives client restart', async () => {
  const id = await product(), a = env.authenticatedContext('a').firestore(), b = env.authenticatedContext('b').firestore()
  const A = inventoryRemote(a, 'inventory-candidate', 'a'), B = inventoryRemote(b, 'inventory-candidate', 'b')
  let latest = [], failure
  const stop = B.watch(rows => { latest = rows }, error => { failure = error })
  const waitFor = async predicate => { const end=Date.now()+10000; while(!predicate()) { if(failure)throw failure;if(Date.now()>end)throw new Error('Listener timeout');await new Promise(r=>setTimeout(r,25)) } }
  try {
    await A.commit(make(id)); await waitFor(()=>latest.some(row=>row.productId===id && row.countPending))
    await A.commit(make(id,{type:'count',quantity:10,expectedRevision:1}))
    await waitFor(()=>latest.some(row=>row.productId===id && row.stock===10))
    const restock=make(id,{type:'restock',quantity:3,expectedRevision:2,unitCost:0,actorUid:'b'})
    const receipt=await B.commit(restock)
    assert.equal(receipt.after.stock,13);assert.equal(receipt.after.costs.lastKnownCost,0)
    assert.deepEqual(await inventoryRemote(b,'inventory-candidate','b').commit(restock),receipt)
    await assert.rejects(()=>B.commit({...restock,quantity:4}),/ya utilizado/)
    assert.equal((await getDoc(doc(a,`${root}/inventory/${id}`))).data().balance.revision,3)
  } finally { stop() }
})
test('simultaneous adjustments conflict instead of losing changes; reviewed retry is explicit', async () => {
  const id=await product(),a=env.authenticatedContext('a').firestore(),b=env.authenticatedContext('b').firestore()
  const A=inventoryRemote(a,'inventory-candidate','a'),B=inventoryRemote(b,'inventory-candidate','b')
  await A.commit(make(id));await A.commit(make(id,{type:'count',quantity:10,expectedRevision:1}))
  const outcomes=await Promise.allSettled([A.commit(make(id,{type:'adjustment',quantity:-2,expectedRevision:2})),B.commit(make(id,{type:'adjustment',quantity:-3,expectedRevision:2,actorUid:'b'}))])
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(outcomes.filter(r=>r.status==='rejected').length,1)
  const balance=(await getDoc(doc(a,`${root}/inventory/${id}`))).data().balance
  assert.ok(balance.stock===7 || balance.stock===8)
  const remaining=balance.stock===8?-3:-2
  await A.commit(make(id,{type:'adjustment',quantity:remaining,expectedRevision:3}))
  assert.equal((await getDoc(doc(b,`${root}/inventory/${id}`))).data().balance.stock,5)
})
test('rules deny anonymous/seller writes, direct stock edits, forged transitions and receipt changes', async () => {
  const id=await product(),db=env.authenticatedContext('a').firestore(),A=inventoryRemote(db,'inventory-candidate','a')
  const opening=make(id),receipt=await A.commit(opening)
  for(const uid of ['s',null]) {
    const denied=(uid?env.authenticatedContext(uid):env.unauthenticatedContext()).firestore()
    await assertFails(setDoc(doc(denied,`${root}/inventory/${id}`),{balance:receipt.after,confirmedAt:serverTimestamp()}))
  }
  await assertFails(updateDoc(doc(db,`${root}/inventory/${id}`),{'balance.stock':999}))
  await assertFails(updateDoc(doc(db,`${root}/inventoryOperations/${opening.operationId}`),{quantityChange:999}))
  await assertFails(deleteDoc(doc(db,`${root}/inventoryOperations/${opening.operationId}`)))
  const intent=make(id,{type:'count',quantity:10,expectedRevision:1}),forged=planInventory(intent,receipt.after)
  forged.after.stock=999;forged.quantityChange=999
  const batch=writeBatch(db)
  batch.set(doc(db,`${root}/inventory/${id}`),{balance:forged.after,confirmedAt:serverTimestamp()})
  batch.set(doc(db,`${root}/inventoryOperations/${intent.operationId}`),{...forged,confirmedAt:serverTimestamp()})
  await assertFails(batch.commit())
  assert.equal((await getDoc(doc(db,`${root}/inventory/${id}`))).data().balance.stock,0)
  assert.equal((await getDoc(doc(db,`${root}/inventoryOperations/${intent.operationId}`))).exists(),false)
})

test('receipt alone and balance alone cannot commit; roles cannot escalate', async () => {
  const id=await product(),db=env.authenticatedContext('a').firestore(),intent=make(id),receipt=planInventory(intent,null)
  await assertFails(setDoc(doc(db,`${root}/inventoryOperations/${intent.operationId}`),{...receipt,confirmedAt:serverTimestamp()}))
  await assertFails(setDoc(doc(db,`${root}/inventory/${id}`),{balance:receipt.after,confirmedAt:serverTimestamp()}))
  const seller=env.authenticatedContext('s').firestore()
  await assertFails(updateDoc(doc(seller,`${root}/members/s`),{role:'administrator'}))
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),`${root}/inventory/${id}`)))
  assert.equal((await getDoc(doc(db,`${root}/inventory/${id}`))).exists(),false)
})

test('stale physical count is rejected and zero remains a confirmed balance', async () => {
  const id=await product(),db=env.authenticatedContext('a').firestore(),A=inventoryRemote(db,'inventory-candidate','a')
  await A.commit(make(id));await A.commit(make(id,{type:'count',quantity:0,expectedRevision:1}))
  await A.commit(make(id,{type:'restock',quantity:2,unitCost:null,expectedRevision:2}))
  await assert.rejects(()=>A.commit(make(id,{type:'count',quantity:0,expectedRevision:2})),/cambió/)
  const result=await A.commit(make(id,{type:'count',quantity:0,expectedRevision:3}))
  assert.equal(result.after.countPending,false);assert.equal(result.after.stock,0)
})
