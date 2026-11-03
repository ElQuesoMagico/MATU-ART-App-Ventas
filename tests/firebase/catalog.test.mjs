import { before,after,test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc,setDoc,updateDoc,getDoc,deleteDoc } from 'firebase/firestore'
import { catalogRemote } from '../../src/services/firebase/catalogRemote.ts'
let env
const workspace='catalog-test', categoryId=crypto.randomUUID(), productId=crypto.randomUUID()
const base={name:'Stickers',description:'',createdAt:new Date().toISOString()}
const category={...base,id:categoryId,entity:'categories',isActive:true,order:0}
const product={...base,id:productId,name:'Producto real solo emulador',entity:'products',categoryId,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product'}
const device=crypto.randomUUID()
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-matu-art-catalog',firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../../firestore.catalog.rules',import.meta.url),'utf8')}})
 await env.withSecurityRulesDisabled(async c=>{for(const [uid,role]of [['a','administrator'],['b','manager'],['s','seller']])await setDoc(doc(c.firestore(),`workspaces/${workspace}/members/${uid}`),{role,enabled:true})})
})
after(async()=>env?.cleanup())
test('catalog rules: two writers, reader, CAS, idempotence, archive and protected fields',async()=>{
 const a=env.authenticatedContext('a').firestore(),b=env.authenticatedContext('b').firestore(),s=env.authenticatedContext('s').firestore()
 const A=catalogRemote(a,workspace,'a'),B=catalogRemote(b,workspace,'b')
 const first={id:crypto.randomUUID(),payload:category,expectedRevision:0}
 assert.equal((await A.commit(first,device)).revision,1)
 assert.equal((await A.commit(first,device)).revision,1)
 await A.commit({id:crypto.randomUUID(),payload:product,expectedRevision:0},device)
 assert.equal((await B.read())[`products/${productId}`].payload.price,600)
 const race=await Promise.allSettled([A.commit({id:crypto.randomUUID(),payload:{...product,price:700},expectedRevision:1},device),B.commit({id:crypto.randomUUID(),payload:{...product,price:800},expectedRevision:1},device)])
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1)
 const current=(await A.read())[`products/${productId}`]
 await A.commit({id:crypto.randomUUID(),payload:{...current.payload,isArchived:true},expectedRevision:2},device)
 await A.commit({id:crypto.randomUUID(),payload:{...current.payload,isArchived:false},expectedRevision:3},device)
 assert.equal((await getDoc(doc(s,`workspaces/${workspace}/products/${productId}`))).data().revision,4)
 await assertFails(catalogRemote(s,workspace,'s').commit({id:crypto.randomUUID(),payload:category,expectedRevision:1},device))
 await assertFails(updateDoc(doc(a,`workspaces/${workspace}/products/${productId}`),{'payload.stock':999}))
 await assertFails(updateDoc(doc(a,`workspaces/${workspace}/products/${productId}`),{'payload.averageCost':0}))
 await assertFails(deleteDoc(doc(a,`workspaces/${workspace}/products/${productId}`)))
 await assertFails(setDoc(doc(s,`workspaces/${workspace}/members/s`),{role:'administrator',enabled:true}))
 await assert.rejects(A.commit({id:crypto.randomUUID(),payload:{...category,id:crypto.randomUUID()},expectedRevision:0},device),/CONFLICT/)
 await assertFails(A.commit({id:crypto.randomUUID(),payload:{...product,id:crypto.randomUUID(),name:'Missing ref',categoryId:crypto.randomUUID()},expectedRevision:0},device))
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),`workspaces/${workspace}/products/${productId}`)))
 // Exercise the maximum reference count against the actual Rules access budget.
 const families=[],ips=[]
 for(const entity of ['families','ips'])for(let n=0;n<3;n++){
   const id=crypto.randomUUID();(entity==='families'?families:ips).push(id)
   await A.commit({id:crypto.randomUUID(),payload:{...category,entity,id,name:`${entity} ${n}`},expectedRevision:0},device)
 }
 const many={...product,id:crypto.randomUUID(),name:'All refs',familyIds:families,ipIds:ips}
 await A.commit({id:crypto.randomUUID(),payload:many,expectedRevision:0},device)
 await A.commit({id:crypto.randomUUID(),payload:{...many,name:'All refs renamed'},expectedRevision:1},device)
 assert.ok((await A.read())[`products/${many.id}`])
 const streamed={...category,id:crypto.randomUUID(),entity:'families',name:'Live listener'}
 let unsubscribe
 let deadline
 const observed=new Promise((resolve,reject)=>{
   deadline=setTimeout(()=>reject(new Error('Listener did not receive record')),10000)
   unsubscribe=B.watch(records=>{if(records[`families/${streamed.id}`])resolve(records)},reject)
 })
 try{await A.commit({id:crypto.randomUUID(),payload:streamed,expectedRevision:0},device);await observed}
 finally{clearTimeout(deadline);unsubscribe?.()}
})
