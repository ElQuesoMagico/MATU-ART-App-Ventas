import {useRef,useState} from 'react'
import {firebaseConnection} from '../../services/firebase/client'
import {localView} from '../../services/firebase/catalogLocal'
import type {LocalView} from '../../services/firebase/catalogLocal'
import {bulkInclusionPreview,includeCatalogRecords} from '../../services/firebase/catalogInclusion'
import type {InclusionChoice,InclusionEntry} from '../../services/firebase/catalogInclusion'
import type {RemoteRecord} from '../../services/firebase/catalogModel'
import {stable} from '../../services/firebase/catalogModel'
import {assertRepairPreview} from '../../services/firebase/catalogRepair'
import {startCatalog} from '../../services/firebase/catalogRuntime'
import type {FirebaseRole} from '../../services/firebase/access'

export function CatalogInclusionReview({uid,role}:{uid:string;role:FirebaseRole}){
 const [snapshot,setSnapshot]=useState<{local:LocalView;remote:Record<string,RemoteRecord>}>()
 const [choices,setChoices]=useState<Record<string,InclusionChoice>>({}),[search,setSearch]=useState('')
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const lock=useRef(false),client=firebaseConnection()!
 const selections=Object.entries(choices).map(([key,choice])=>({key,choice}))
 let entries:InclusionEntry[]=[],problem=''
 if(snapshot&&selections.length)try{entries=bulkInclusionPreview(snapshot.local,snapshot.remote,selections)}catch(e){problem=e instanceof Error?e.message:String(e)}
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await action()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}}
 return <section>
  <button type="button" className="button secondary" disabled={busy||!navigator.onLine} onClick={()=>void run(async()=>{const remote=await client.catalog().read();setSnapshot({local:await localView(),remote});setChoices({});setConfirmed(false)})}>Revisar registros no incorporados</button>
  {snapshot&&<div className="panel" style={{overflowWrap:'anywhere'}}>
   <h4>Incorporar registros al catálogo compartido</h4>
   <p>Selecciona varios registros y revisa sus versiones. Coincidir por UUID permite reconocer la identidad; el nombre por sí solo no demuestra que sea un dato comercial.</p>
   <button type="button" className="button secondary" disabled={busy} onClick={()=>{setChoices(Object.fromEntries((snapshot.local.state?.excluded??[]).filter(key=>snapshot.local.records[key]&&snapshot.remote[key]&&stable(snapshot.local.records[key])===stable(snapshot.remote[key].payload)).map(key=>[key,'remote'])));setConfirmed(false)}}>Seleccionar coincidencias exactas por UUID</button>
   <label>Buscar registros<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <div style={{maxHeight:'40dvh',overflowY:'auto'}}>
    {(snapshot.local.state?.excluded??[]).filter(key=>`${key} ${snapshot.local.records[key]?.name??''} ${snapshot.remote[key]?.payload.name??''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(key=>{
     const local=snapshot.local.records[key],remote=snapshot.remote[key]?.payload
     return <div key={key} className="panel">
      <strong>{local?.name??remote?.name??key}</strong><p>{key}</p>
      <p>{local&&remote?'Mismo UUID en ambos catálogos':remote?'Solo nube':'Solo local · procedencia por revisar'}</p>
      {/\b(test|prueba|demo|qa)\b/i.test(local?.name??remote?.name??'')&&<p>Posible dato de prueba por su nombre. Requiere revisión.</p>}
      <details><summary>Comparar versiones</summary><p>Local</p><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(local??null,null,2)}</pre><p>Nube · revisión {snapshot.remote[key]?.revision??'—'}</p><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(remote??null,null,2)}</pre></details>
      <label>Versión que se incorporará<select disabled={busy} value={choices[key]??''} onChange={e=>{const value=e.target.value;setChoices(previous=>{const next={...previous};if(value)next[key]=value as InclusionChoice;else delete next[key];return next});setConfirmed(false)}}>
       <option value="">Mantener sin incorporar</option>
       {local&&role!=='seller'&&<option value="local">Conservar local</option>}
       {remote&&<option value="remote">Usar nube</option>}
      </select></label>
     </div>
    })}
   </div>
   <p>{selections.length} seleccionados. {entries.length} registros incluidos contando las clasificaciones necesarias. El resto se conserva sin incorporar.</p>
   {problem&&<p role="alert" className="storage-error">{problem}</p>}
   {!!entries.length&&<details open><summary>Cambios propuestos</summary><ul>{entries.map(e=><li key={e.key}>{e.payload.name}: {{upload:'Enviar local',download:'Recibir nube',match:'Vincular coincidencia'}[e.action]}</li>)}</ul></details>}
   <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo las versiones seleccionadas y sus clasificaciones. Stock, costos e históricos no se sincronizan.</label>
   <button type="button" className="button primary" disabled={busy||!confirmed||!entries.length||!!problem||!navigator.onLine} onClick={()=>void run(async()=>{
    const access=await client.verify(),remote=await client.catalog().read()
    await navigator.locks.request('matu-catalog-sync',async()=>{await assertRepairPreview(snapshot.local,snapshot.remote,remote);await includeCatalogRecords(snapshot.local,remote,selections,uid,client.workspaceId,access.role)})
    setSnapshot(undefined);setChoices({});setConfirmed(false);setMessage('Incorporación local guardada. Los envíos quedan pendientes hasta recibir la confirmación de Firestore.')
    await startCatalog(uid,access.role)
   })}>Confirmar incorporación seleccionada</button>
   <button type="button" className="button secondary" disabled={busy} onClick={()=>setSnapshot(undefined)}>Cancelar sin cambios</button>
  </div>}
  {busy&&<p role="status">Revisando catálogo…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="storage-error">{error}</p>}
 </section>
}
