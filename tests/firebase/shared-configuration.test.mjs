import { before,after,test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment,assertFails } from '@firebase/rules-unit-testing'
import { doc,setDoc,updateDoc,deleteDoc } from 'firebase/firestore'
import { configurationRemote } from '../../src/services/firebase/commercial/configurationRemote.ts'
let env
const workspace='commercial-config',root=`workspaces/${workspace}`
before(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw new Error('Local emulator required')
  env=await initializeTestEnvironment({projectId:'demo-matu-configuration',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../../firestore.commercial.rules',import.meta.url),'utf8')}})
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async c=>{for(const[uid,role]of[['a','administrator'],['b','manager'],['s','seller']])await setDoc(doc(c.firestore(),`${root}/members/${uid}`),{role,enabled:true})})
})
after(async()=>{await env?.cleanup()})
test('event activation/closure and special prices arrive by listener; CAS and operation UUID preserve audit',async()=>{
  const a=env.authenticatedContext('a').firestore(),b=env.authenticatedContext('b').firestore(),A=configurationRemote(a,workspace,'a'),B=configurationRemote(b,workspace,'b')
  const now=new Date().toISOString(),eventId=crypto.randomUUID(),payload={events:[{id:eventId,name:'Feria',startDate:'2026-11-11',endDate:'2026-11-12',createdAt:now,updatedAt:now,status:'active',activeKey:'active'}],promotions:[],expenses:[],expenseCategories:[],expenseChanges:[],packs:[],eventPrices:[{productId:crypto.randomUUID(),prices:[{eventId,price:0}]}]}
  const intent={operationId:crypto.randomUUID(),actorUid:'a',deviceId:crypto.randomUUID(),expectedRevision:0,payload}
  let received,error
  const stop=B.watch(r=>{received=r},e=>{error=e})
  async function wait(revision){const end=Date.now()+5000;while(received?.revision!==revision){if(error)throw error;if(Date.now()>end)throw new Error('Listener timeout');await new Promise(r=>setTimeout(r,20))}}
  try{
    const first=await A.commit(intent);await wait(1);assert.equal(received.payload.events[0].name,'Feria');assert.equal(received.payload.eventPrices[0].prices[0].price,0)
    assert.deepEqual(await A.commit(intent),first)
    const next={...intent,actorUid:'b',operationId:crypto.randomUUID(),expectedRevision:1,payload:{...payload,events:[{...payload.events[0],activeKey:undefined,status:'finished',finishedAt:now}]}}
    await B.commit(next);await wait(2);assert.equal(received.payload.events[0].status,'finished')
    await assert.rejects(()=>A.commit({...intent,operationId:crypto.randomUUID(),expectedRevision:1}),/CONFLICT/)
    await assertFails(updateDoc(doc(a,`${root}/configurationOperations/${intent.operationId}`),{confirmedAt:null}))
    await assertFails(deleteDoc(doc(a,`${root}/commercialConfiguration/current`)))
    await assertFails(configurationRemote(env.authenticatedContext('s').firestore(),workspace,'s').commit({...intent,actorUid:'s',operationId:crypto.randomUUID(),expectedRevision:2}))
    await assertFails(configurationRemote(env.unauthenticatedContext().firestore(),workspace,'a').read())
  }finally{stop()}
})
