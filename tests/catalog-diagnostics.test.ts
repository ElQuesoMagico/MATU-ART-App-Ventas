import {test} from 'node:test'
import assert from 'node:assert/strict'
import {catalogDiagnostics} from '../src/services/firebase/catalogDiagnostics.ts'
import type {LocalView} from '../src/services/firebase/catalogLocal.ts'
import type {RemoteRecord} from '../src/services/firebase/catalogModel.ts'
const payload={entity:'products' as const,id:crypto.randomUUID(),name:'Ame chan',description:'',createdAt:new Date().toISOString(),categoryId:crypto.randomUUID(),familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product' as const}
const key=`products/${payload.id}`,record:RemoteRecord={payload,revision:2,operationId:crypto.randomUUID()}
function local():LocalView{return {records:{[key]:payload},invalid:{},token:'read-only',state:{key:'catalog',workspaceId:'w',ownerUid:'u',deviceId:crypto.randomUUID(),canWrite:true,baseline:{[key]:record},pending:{},conflicts:{},excluded:[]}}}
test('diagnostic distinguishes excluded, renamed, confirmed and remote-only without changing state',()=>{
 const view=local(),remote={[key]:record},before=JSON.stringify(view)
 assert.equal(catalogDiagnostics(view,remote)[0].status,'Coincide y confirmado')
 assert.equal(JSON.stringify(view),before)
 view.state!.excluded=[key]
 assert.equal(catalogDiagnostics(view,remote)[0].status,'Excluido de sincronización')
 view.state!.excluded=[];view.records[key]={...payload,name:'Sticker Ame chan'}
 const row=catalogDiagnostics(view,remote)[0]
 assert.equal(row.status,'Diferencias local/nube');assert.equal(row.remote!.name,'Ame chan');assert.equal(row.local!.name,'Sticker Ame chan')
 delete view.records[key]
 assert.equal(catalogDiagnostics(view,remote)[0].status,'Solo en la nube')
})
