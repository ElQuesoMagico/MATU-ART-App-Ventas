// Isolated visual fixture: no Firebase client, IndexedDB writes or production data.
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CatalogInclusionReview} from '../../src/components/cloud/CatalogInclusionReview'
import type {CatalogReviewServices} from '../../src/components/cloud/CatalogInclusionReview'
import {bulkInclusionPreview} from '../../src/services/firebase/catalogInclusion'
import type {Payload,SyncState} from '../../src/services/firebase/catalogModel'
import '../../src/index.css'
import '../../src/App.css'
import '../../src/styles/themes.css'
const cat:Payload={entity:'categories',id:'10000000-0000-4000-8000-000000000001',name:'Stickers',description:'',createdAt:'2026-11-01T00:00:00Z',isActive:true,order:0}
const p:Payload={entity:'products',id:'10000000-0000-4000-8000-000000000002',name:'Sticker Kirby',description:'',createdAt:cat.createdAt,categoryId:cat.id,familyIds:[],ipIds:[],price:600,isArchived:false,isFavorite:false,kind:'product'}
const key=`products/${p.id}`,ref=`categories/${cat.id}`,second={...p,id:'10000000-0000-4000-8000-000000000003',name:'Libreta ilustrada',price:3000},key2=`products/${second.id}`
const state:SyncState={key:'catalog',workspaceId:'fixture',ownerUid:'fixture',deviceId:'10000000-0000-4000-8000-000000000004',canWrite:true,baseline:{},pending:{},excluded:[key,key2],conflicts:{}}
const remote={[ref]:{payload:cat,revision:1,operationId:'fixture'},[key]:{payload:{...p,name:'Kirby',price:700},revision:1,operationId:'fixture'}}
const snapshot={local:{records:{[ref]:cat,[key]:p,[key2]:second},invalid:{},state,token:'fixture'},remote}
let confirmations=0,fail=false,connected=true
const api:CatalogReviewServices={load:async()=>{if(fail)throw new Error('network unavailable');return structuredClone(snapshot)},confirm:async(s,choices)=>{if(fail)throw new Error('El catálogo cambió');const entries=bulkInclusionPreview(s.local,s.remote,choices);for(const e of entries){state.excluded=state.excluded.filter(k=>k!==e.key);if(e.action==='upload')state.pending[e.key]={id:'fixture',payload:e.payload,expectedRevision:0};else state.baseline[e.key]={payload:e.payload,revision:1,operationId:'fixture'}}confirmations++},status:async()=>({state}),retry:async()=>{for(const [k,pending] of Object.entries(state.pending)){state.baseline[k]={payload:pending.payload,revision:2,operationId:'fixture'};delete state.pending[k]}}}
export function Fixture(){const [count,setCount]=useState(0);return <div style={{maxWidth:720,margin:'0 auto',padding:16}}><p>Prueba aislada · Sin datos reales</p><div className="pending-actions"><button type="button" onClick={()=>{fail=!fail;setCount(c=>c+1)}}>Simular error {String(fail)}</button><button type="button" onClick={()=>{connected=!connected;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>connected});window.dispatchEvent(new Event(connected?'online':'offline'));setCount(c=>c+1)}}>Simular conexión {String(connected)}</button><button type="button" onClick={()=>setCount(c=>c+1)}>Consultar confirmaciones</button></div><p>Confirmaciones: {confirmations} · Control {count}</p><CatalogInclusionReview uid="fixture" role="administrator" services={api}/></div>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
