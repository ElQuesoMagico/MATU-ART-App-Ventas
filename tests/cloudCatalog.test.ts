import test from 'node:test'
import assert from 'node:assert/strict'
import {applyCatalogChanges,catalogOperation,type CatalogOperation,type CloudRecord} from '../src/services/cloud/catalogContract.ts'
import {catalogRequest} from '../backend/src/catalog.ts'
import {cloudBase} from '../src/services/cloud/client.ts'
const id=()=>crypto.randomUUID(),date='2026-10-21T12:00:00.000Z'
const category={entity:'categories' as const,payload:{id:id(),name:'Stickers',createdAt:date,updatedAt:date,isActive:true,order:0}}
const product={entity:'products' as const,payload:{id:id(),name:'Producto',createdAt:date,updatedAt:date,categoryId:category.payload.id,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product' as const,stockPolicy:'local-only' as const}}
const operation=():CatalogOperation=>({version:1,operationId:id(),deviceId:id(),changes:[{record:category,expectedRevision:null},{record:product,expectedRevision:null}]})
test('catalog contract keeps UUID and relations; no stock, costs or transactional fields',()=>{
 const input=operation(),result=applyCatalogChanges([],input)
 assert.equal(result[1].record.payload.id,product.payload.id);assert.equal(result[1].revision,1)
 assert.throws(()=>catalogOperation.parse({...input,changes:[{record:{...product,payload:{...product.payload,stock:0}},expectedRevision:null}]}))
 assert.throws(()=>catalogOperation.parse({...input,changes:[{record:{entity:'sales',payload:{}},expectedRevision:null}]}))
 assert.deepEqual(input,operationWithIds(input))
})
function operationWithIds(input:CatalogOperation){return {...operation(),operationId:input.operationId,deviceId:input.deviceId}}
test('catalog CAS rejects stale revisions, duplicated entries, names and missing references',()=>{
 const records=applyCatalogChanges([],operation())
 assert.throws(()=>applyCatalogChanges(records,operation()),/CONFLICT/)
 const update:CatalogOperation={...operation(),changes:[{record:{...product,payload:{...product.payload,price:700}},expectedRevision:1}]}
 const changed=applyCatalogChanges(records,update);assert.equal(changed[1].revision,2)
 assert.throws(()=>applyCatalogChanges(changed,update),/CONFLICT/)
 assert.throws(()=>applyCatalogChanges([],{...operation(),changes:[operation().changes[1]]}),/MISSING_REFERENCE/)
 assert.throws(()=>applyCatalogChanges([],{...operation(),changes:[operation().changes[0],operation().changes[0]]}),/DUPLICATE_RECORD/)
 const duplicate:CloudRecord={record:{...category,payload:{...category.payload,id:id(),name:'STICKERS'}},revision:1}
 assert.throws(()=>applyCatalogChanges([duplicate],operation()),/NAME_CONFLICT/)
})
test('catalog administration is server gated; nothing published without configuration/admin',async()=>{
 const env={DB:{prepare(){throw new Error('Should not access D1')}},APP_ORIGIN:'https://example.test',GAS_URL:'',GAS_KEY_ID:'v1',WORKSPACE_ID:id()}
 const session={id:id(),username:'seller',role:'seller' as const,disabled:0,password_hash:'',csrf:'',expires_at:0}
 await assert.rejects(catalogRequest('publish',operation(),env,session),/FORBIDDEN/)
 await assert.rejects(catalogRequest('initialize',{},env,{...session,role:'administrator'}),/INVALID_REQUEST/)
})
test('github.io cross-site cookie API remains rejected; no weakening to SameSite=None',()=>{
 assert.throws(()=>cloudBase('https://matu.user.workers.dev/api','https://user.github.io'))
 assert.equal(cloudBase('','https://user.github.io'),'')
 assert.equal(cloudBase('/api','https://matu.example'),'https://matu.example/api')
})
