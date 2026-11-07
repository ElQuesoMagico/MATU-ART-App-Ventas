import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reviewRows,reviewDifferences,bulkReviewChoices,reviewError,reviewOutcome} from '../src/services/firebase/catalogReview.ts'
import type {LocalView} from '../src/services/firebase/catalogLocal.ts'
import type {Payload,RemoteRecord,SyncState} from '../src/services/firebase/catalogModel.ts'
const cat:Payload={entity:'categories',id:crypto.randomUUID(),name:'Stickers',description:'',order:0,isActive:true,createdAt:new Date().toISOString()}
const p:Payload={entity:'products',id:crypto.randomUUID(),name:'Sticker Kirby',description:'',categoryId:cat.id,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product',createdAt:cat.createdAt}
const key=`products/${p.id}`,ref=`categories/${cat.id}`
function fixture(){
 const state:SyncState={key:'catalog',workspaceId:'w',deviceId:crypto.randomUUID(),ownerUid:'u',canWrite:true,baseline:{},pending:{},excluded:[key],conflicts:{}}
 const local:LocalView={records:{[key]:p,[ref]:cat},invalid:{},state,token:'preview'}
 const remote:Record<string,RemoteRecord>={[key]:{payload:{...p,name:'Kirby',price:700},revision:2,operationId:crypto.randomUUID()},[ref]:{payload:cat,revision:1,operationId:crypto.randomUUID()}}
 return {local,remote}
}
test('normal comparison presents only relevant differences with readable values, not IDs',()=>{
 const s=fixture(),rows=reviewRows(s.local,s.remote)
 assert.equal(rows[0].reason,'Encontramos cambios diferentes.')
 const diffs=reviewDifferences(p,s.remote[key].payload,s.local,s.remote)
 assert.deepEqual(diffs.map(d=>d.label),['Nombre','Precio'])
 assert.equal(diffs[1].here,'$600');assert.equal(diffs[1].there,'$700')
 assert.ok(!JSON.stringify(diffs).includes(p.id))
})
test('shared unchanged and new automatic records do not appear; exclusions remain visible',()=>{
 const s=fixture();s.local.state!.excluded=[]
 assert.equal(reviewRows(s.local,s.remote).length,0)
 s.local.state!.excluded=[key];s.remote[key].payload=p
 assert.match(reviewRows(s.local,s.remote)[0].reason,/futuras actualizaciones/)
})
test('similar names never merge; ambiguous rows cannot join safe bulk actions',()=>{
 const s=fixture(),id=crypto.randomUUID()
 delete s.remote[key];s.remote[`products/${id}`]={payload:{...p,id,name:'Kirby'},revision:1,operationId:crypto.randomUUID()}
 const rows=reviewRows(s.local,s.remote)
 assert.equal(rows[0].similar.length,1);assert.equal(rows[0].safe,false)
 assert.deepEqual(bulkReviewChoices(rows,[key],{}),{})
 assert.match(rows[0].reason,/parecido/)
})
test('bulk actions only choose safe selected rows; choices and inputs stay immutable',()=>{
 const s=fixture();delete s.remote[key];const before=JSON.stringify(s)
 assert.deepEqual(bulkReviewChoices(reviewRows(s.local,s.remote),[key],{}),{[key]:'local'})
 assert.equal(JSON.stringify(s),before)
 s.local.records[key]={...p,name:'QA test'}
 assert.deepEqual(bulkReviewChoices(reviewRows(s.local,s.remote),[key],{}),{})
})
test('errors explain recovery without exposing raw infrastructure codes',()=>{
 for(const error of [new Error('CONFLICT revision'),new Error('UUID coincide'),{code:'permission-denied'},new Error('network unavailable')]){
  const message=reviewError(error);assert.ok(message.length>30);assert.doesNotMatch(message,/UUID|Firebase|CONFLICT|permission-denied/)
 }
})

test('remote-only category and product are selectable and prepare downloads',()=>{
 const s=fixture();delete s.local.records[key];delete s.local.records[ref]
 s.local.state!.excluded=[ref,key]
 const rows=reviewRows(s.local,s.remote)
 assert.ok(rows.every(row=>row.safe))
 assert.deepEqual(bulkReviewChoices(rows,[ref,key],{}),{[ref]:'remote',[key]:'remote'})
})

test('remote-only item with a similar local identity or invalid local version requires individual review',()=>{
 const s=fixture();delete s.local.records[key]
 const other=crypto.randomUUID();s.local.records[`products/${other}`]={...p,id:other}
 let rows=reviewRows(s.local,s.remote)
 assert.equal(rows[0].safe,false);assert.equal(rows[0].similar.length,1)
 assert.deepEqual(bulkReviewChoices(rows,[key],{}),{})
 delete s.local.records[`products/${other}`];s.local.invalid[key]='invalid local version'
 rows=reviewRows(s.local,s.remote);assert.equal(rows[0].safe,false)
})
test('results never call queued or conflicted writes successful; confirmation changes status',()=>{
 const s=fixture(),entry={key,payload:p,action:'upload' as const},state=s.local.state!
 state.excluded=[];state.pending[key]={id:crypto.randomUUID(),payload:p,expectedRevision:2}
 assert.deepEqual(reviewOutcome([entry],state),{done:0,pending:1,failed:0})
 delete state.pending[key];state.baseline[key]={payload:p,revision:3,operationId:crypto.randomUUID()}
 assert.deepEqual(reviewOutcome([entry],state),{done:1,pending:0,failed:0})
 state.conflicts[key]='CONFLICT';assert.deepEqual(reviewOutcome([entry],state),{done:0,pending:0,failed:1})
})
