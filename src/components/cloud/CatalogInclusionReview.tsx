import {useEffect,useRef,useState} from 'react'
import {firebaseConnection} from '../../services/firebase/client'
import {localView} from '../../services/firebase/catalogLocal'
import type {LocalView} from '../../services/firebase/catalogLocal'
import {bulkInclusionPreview,includeCatalogRecords} from '../../services/firebase/catalogInclusion'
import type {InclusionChoice,InclusionEntry,InclusionSelection} from '../../services/firebase/catalogInclusion'
import type {RemoteRecord,SyncState} from '../../services/firebase/catalogModel'
import {assertRepairPreview} from '../../services/firebase/catalogRepair'
import {catalogStatus,startCatalog,reportCatalogError} from '../../services/firebase/catalogRuntime'
import type {FirebaseRole} from '../../services/firebase/access'
import {bulkReviewChoices,reviewDifferences,reviewError,reviewOutcome,reviewRows,elementCount} from '../../services/firebase/catalogReview'
import '../../styles/catalog-review.css'

export interface ReviewSnapshot {local:LocalView;remote:Record<string,RemoteRecord>}
export interface CatalogReviewServices {
 load:()=>Promise<ReviewSnapshot>
 confirm:(snapshot:ReviewSnapshot,selections:InclusionSelection[])=>Promise<void>
 status:()=>Promise<{state?:SyncState;error?:string}>
 retry:()=>Promise<void>
}
function reviewServices(uid:string):CatalogReviewServices {
 const client=firebaseConnection()!
 return {
  load:async()=>{const remote=await client.catalog().read();return {local:await localView(),remote}},
  confirm:async(snapshot,selections)=>{
   const access=await client.verify(),remote=await client.catalog().read()
   await navigator.locks.request('matu-catalog-sync',async()=>{await assertRepairPreview(snapshot.local,snapshot.remote,remote);await includeCatalogRecords(snapshot.local,remote,selections,uid,client.workspaceId,access.role)})
   try { await startCatalog(uid,access.role) } catch(cause) { reportCatalogError(cause instanceof Error?cause.message:'No se pudo iniciar el envío.') }
  },
  status:async()=>({state:(await localView()).state,error:catalogStatus().error}),
  retry:async()=>{const access=await client.verify();await startCatalog(uid,access.role)},
 }
}
export function CatalogInclusionReview({uid,role,services}:{uid:string;role:FirebaseRole;services?:CatalogReviewServices}){
 const [api]=useState(()=>services??reviewServices(uid))
 const [snapshot,setSnapshot]=useState<ReviewSnapshot>(),[step,setStep]=useState<'closed'|'detect'|'review'|'confirm'|'result'>('closed')
 const [choices,setChoices]=useState<Record<string,InclusionChoice>>({}),[selected,setSelected]=useState<string[]>([])
 const [search,setSearch]=useState(''),[page,setPage]=useState(0)
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[online,setOnline]=useState(navigator.onLine)
 const [completed,setCompleted]=useState<InclusionEntry[]>([]),[outcome,setOutcome]=useState({done:0,pending:0,failed:0})
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[])
 useEffect(()=>{heading.current?.focus()},[step])
 useEffect(()=>{
  if(step!=='result')return
  let active=true
  const refresh=()=>void api.status().then(value=>{if(active){setOutcome(reviewOutcome(completed,value.state));setError(value.error?new Error(value.error):undefined)}}).catch(cause=>{if(active)setError(cause)})
  refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)}
 },[step,completed,api])
 const rows=snapshot?reviewRows(snapshot.local,snapshot.remote):[]
 const filtered=rows.filter(row=>`${row.name} ${row.type}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 const selections=Object.entries(choices).map(([key,choice])=>({key,choice}))
 let entries:InclusionEntry[]=[],problem:unknown
 if(snapshot&&selections.length)try{entries=bulkInclusionPreview(snapshot.local,snapshot.remote,selections)}catch(cause){problem=cause}
 const change=(key:string,value?:InclusionChoice)=>setChoices(previous=>{const next={...previous};if(value)next[key]=value;else delete next[key];return next})
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);try{await action()}catch(cause){setError(cause)}finally{lock.current=false;setBusy(false)}}
 const load=()=>run(async()=>{setSnapshot(await api.load());setChoices({});setSelected([]);setSearch('');setPage(0);setStep('detect')})
 const unchanged=rows.filter(row=>!entries.some(entry=>entry.key===row.key)).length
 const card=(row:typeof rows[number])=><article className="pending-card" key={row.key}>
  <div className="pending-card-heading"><div><span className="pending-type">{row.type}</span><h5>{row.name}</h5></div>
   {row.safe&&role!=='seller'&&<label className="pending-select"><input type="checkbox" aria-label={`Seleccionar ${row.name}`} checked={selected.includes(row.key)} disabled={busy} onChange={e=>setSelected(previous=>e.target.checked?[...previous,row.key]:previous.filter(k=>k!==row.key))}/>Seleccionar</label>}
  </div>
  <p>{row.reason}</p>
  {row.test&&<p className="local-note">Parece un dato de prueba por su nombre. Revisa si quieres compartirlo.</p>}
  {row.different&&snapshot&&<><p><strong>¿Qué cambios quieres mantener?</strong></p><div className="pending-differences">{reviewDifferences(row.here,row.there,snapshot.local,snapshot.remote).map(diff=><div className="pending-difference" key={diff.field}><strong>{diff.label}</strong><div><small>Este dispositivo</small><span>{diff.here}</span></div><div><small>Otros dispositivos</small><span>{diff.there}</span></div></div>)}</div></>}
  {row.similar.length>0&&snapshot&&<details><summary>Comparar con el elemento parecido</summary>{row.similar.map(([key,r])=><div key={key}><strong>{r.payload.name}</strong>{reviewDifferences(row.here,r.payload,snapshot.local,snapshot.remote).map(diff=><p key={diff.field}>{diff.label}: {diff.here} → {diff.there}</p>)}<p>No se fusionarán automáticamente. Si son distintos, dales nombres diferentes desde Inventario antes de compartirlos.</p></div>)}</details>}
  <div className="pending-actions">
   {row.here&&(!row.there||row.different)&&role!=='seller'&&<button type="button" className={`button ${choices[row.key]==='local'?'primary':'secondary'}`} aria-pressed={choices[row.key]==='local'} onClick={()=>change(row.key,'local')}>{row.different?'Usar los cambios de este dispositivo':'Compartir con los demás dispositivos'}</button>}
   {row.there&&<button type="button" className={`button ${choices[row.key]==='remote'?'primary':'secondary'}`} aria-pressed={choices[row.key]==='remote'} onClick={()=>change(row.key,'remote')}>{row.different?'Usar los cambios compartidos':row.here?'Activar actualizaciones automáticas':'Usar la versión de los demás dispositivos'}</button>}
   <button type="button" className="button text-button" onClick={()=>change(row.key)}>Dejar sin cambios por ahora</button>
  </div>
  {choices[row.key]&&<p className="pending-decision">Elegido: {choices[row.key]==='local'?'compartir los cambios de este dispositivo':'usar los cambios compartidos'}. Se aplicará al confirmar.</p>}
  <details className="pending-technical"><summary>Información técnica</summary><p>{row.key}</p><pre>{JSON.stringify({local:row.here,remote:row.there},null,2)}</pre></details>
 </article>
 return <section className="pending-review" aria-label="Revisión de datos pendientes">
  {step==='closed'?<button type="button" className="button secondary" disabled={busy||!online} onClick={()=>void load()}>Revisar datos pendientes</button>:<>
   <header className="pending-heading"><span className="pending-type">{step==='detect'?'1 · Detectar':step==='review'?'2 · Revisar':step==='confirm'?'3 · Confirmar':'4 · Resultado'}</span><h4 ref={heading} tabIndex={-1}>Revisar datos pendientes</h4></header>
   {step==='detect'&&<>
    <p>{rows.length?'Encontramos productos o clasificaciones que todavía no aparecen en tus otros dispositivos o necesitan activar sus actualizaciones.':'No hay datos antiguos pendientes de revisar. Los cambios habituales se comparten automáticamente.'}</p>
    {!!rows.length&&<p><strong>{elementCount(rows.length)} {rows.length===1?'necesita':'necesitan'} revisión.</strong> Aún no hemos cambiado nada.</p>}
    {!!rows.length&&<button type="button" className="button primary" onClick={()=>setStep('review')}>Revisar {elementCount(rows.length)}</button>}
   </>}
   {step==='review'&&<>
    <p>Elige qué compartir. Lo que dejes pendiente seguirá guardado en este dispositivo.</p>
    <label>Buscar por nombre o tipo<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}}/></label>
    {role!=='seller'&&<div className="pending-bulk"><span>{selected.length} seleccionados para acción conjunta</span><button type="button" className="button secondary" disabled={!selected.length} onClick={()=>{setChoices(previous=>bulkReviewChoices(rows,selected,previous));setSelected([])}}>Compartir seleccionados</button><button type="button" className="button secondary" disabled={!selected.length} onClick={()=>{setChoices(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!selected.includes(key))));setSelected([])}}>Dejar pendientes</button></div>}
    <p className="local-note">Los elementos con cambios diferentes o posibles duplicados se revisan individualmente.</p>
    <div className="pending-list">{filtered.slice(page*6,page*6+6).map(card)}{!filtered.length&&<p>No encontramos elementos con ese nombre.</p>}</div>
    {filtered.length>6&&<nav className="pending-pagination" aria-label="Páginas de pendientes"><button type="button" className="button secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>{page+1} de {Math.ceil(filtered.length/6)}</span><button type="button" className="button secondary" disabled={(page+1)*6>=filtered.length} onClick={()=>setPage(p=>p+1)}>Siguiente</button></nav>}
    {!!problem&&<p role="alert" className="storage-error">{reviewError(problem)}</p>}
    <div className="pending-footer"><span>{selections.length} decisiones preparadas</span><button type="button" className="button primary" disabled={!entries.length||!!problem||busy} onClick={()=>setStep('confirm')}>Ver resumen</button></div>
   </>}
   {step==='confirm'&&<>
    <p>Esto ocurrirá al confirmar. También incluimos las clasificaciones necesarias para tus productos.</p>
    <ul className="pending-summary">{entries.map(entry=><li key={entry.key}><strong>{entry.payload.name}</strong><span>{entry.action==='upload'?'Compartir con los demás dispositivos':entry.action==='download'?'Usar la versión de los demás dispositivos':'Activar futuras actualizaciones'}</span></li>)}</ul>
    <p><strong>{elementCount(entries.length)}: se aplicarán las decisiones indicadas.</strong> {elementCount(unchanged)} sin cambios.</p>
    <p>No se borrarán productos ni se cambiarán stock, costos o ventas anteriores. Solo se aplicarán los datos del catálogo que elegiste.</p>
    <div className="pending-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setStep('review')}>Volver a revisar</button><button type="button" className="button primary" disabled={busy||!online||!entries.length||!!problem} onClick={()=>void run(async()=>{await api.confirm(snapshot!,selections);setCompleted(entries);setOutcome({done:0,pending:entries.length,failed:0});setStep('result')})}>Confirmar cambios</button></div>
   </>}
   {step==='result'&&<div role="status">
    {!!outcome.done&&<p><strong>{elementCount(outcome.done)} {outcome.done===1?'actualizado y compartido':'actualizados y compartidos'} correctamente.</strong></p>}
    {!!outcome.pending&&<p>{elementCount(outcome.pending)} {outcome.pending===1?'quedó pendiente':'quedaron pendientes'}. El envío continuará automáticamente cuando haya conexión y acceso disponible.</p>}
    {!!outcome.failed&&<p>No pudimos actualizar {elementCount(outcome.failed)} porque encontramos cambios diferentes. Tus datos siguen guardados.</p>}
    {!outcome.pending&&!outcome.failed&&<p>Las próximas ediciones de estos elementos se compartirán automáticamente.</p>}
    <p>{elementCount(unchanged)} sin cambios.</p>
    {(outcome.pending>0||!!error)&&<button type="button" className="button secondary" disabled={busy||!online} onClick={()=>void run(api.retry)}>Intentar nuevamente</button>}
   </div>}
   <button type="button" className="button secondary" disabled={busy} onClick={()=>{setStep('closed');setSnapshot(undefined);setChoices({});setSelected([]);setError(undefined)}}>{step==='result'?'Listo':'Cancelar sin cambios'}</button>
  </>}
  {!online&&<p className="stock-warning">Sin conexión. Tus decisiones se conservan en esta revisión; podrás confirmar cuando vuelva Internet.</p>}
  {busy&&<p role="status">{step==='confirm'?'Guardando tus decisiones…':'Consultando datos…'}</p>}
  {!!error&&<div role="alert" className="storage-error"><p>{reviewError(error)}</p>{step!=='result'&&<button type="button" className="button secondary" disabled={busy||!online} onClick={()=>void load()}>Volver a comparar</button>}</div>}
  {!!(error||problem)&&<details className="pending-technical"><summary>Información técnica</summary><pre>{String(error||problem)}</pre></details>}
 </section>
}
