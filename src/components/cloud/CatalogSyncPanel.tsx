import { useEffect, useRef, useState } from 'react'
import { firebaseConnection } from '../../services/firebase/client'
import { includeUploadDependencies, linkCatalog, localView, preview, resolveConflict, unlinkCatalog } from '../../services/firebase/catalogLocal'
import type { Choice, LocalView } from '../../services/firebase/catalogLocal'
import type { Payload, RemoteRecord } from '../../services/firebase/catalogModel'
import type { FirebaseRole } from '../../services/firebase/access'
import { catalogStatus, startCatalog, stopCatalog } from '../../services/firebase/catalogRuntime'
import { adoptCatalogAccount, assertRepairPreview, classificationRepairs, repairClassification } from '../../services/firebase/catalogRepair'

const priceText=(p?:Payload)=>p?.entity==='products'?`${p.price.toLocaleString('es-CL')} CLP`:'—'
const entityLabels={categories:'Categorías',families:'Familias',ips:'IPs',products:'Productos'}
export function CatalogSyncPanel({uid,role}:{uid:string;role:FirebaseRole}){
  const [view,setView]=useState<LocalView>(),[remote,setRemote]=useState<Record<string,RemoteRecord>>()
  const [review,setReview]=useState<LocalView>()
  const [repair,setRepair]=useState<{local:LocalView;remote:Record<string,RemoteRecord>}>()
  const [backupConfirmed,setBackupConfirmed]=useState(false)
  const [choices,setChoices]=useState<Choice[]>([]),[confirmed,setConfirmed]=useState(false)
  const [entity,setEntity]=useState('all'),[search,setSearch]=useState('')
  const lock=useRef(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(catalogStatus())
  const client=firebaseConnection()!,canWrite=role!=='seller'
  const enabled=client.catalogEnabled
  useEffect(()=>{let active=true;const refresh=()=>{void localView().then(v=>{if(active){setView(v);setStatus(catalogStatus())}}).catch(e=>{if(active)setError(String(e))})};refresh();const timer=setInterval(refresh,3000);return()=>{active=false;clearInterval(timer)}},[])
  async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();setView(await localView())}catch(e){setError(e instanceof Error?e.message:'No se pudo completar.')}finally{lock.current=false;setBusy(false)}}
  async function compare(){const local=await localView(),cloud=await client.catalog().read();setView(local);setReview(local);setRemote(cloud);setConfirmed(false);setChoices(preview(local,cloud).map(row=>({key:row.key,action:'exclude'})))}
  const rows=review&&remote?preview(review,remote):[]
  return <section className="catalog-sync-panel">
    <h3>Catálogo compartido</h3>
    {!enabled?<p>Sincronización desactivada en esta versión. Puedes comprobar la lectura del catálogo sin subir ni modificar datos.</p>:<>
      <p>{view?.state?'Dispositivo vinculado':'Sin vinculación inicial'} · {Object.keys(view?.state?.pending??{}).length} pendientes · {Object.keys(view?.state?.conflicts??{}).length} conflictos</p>
      {view?.state&&<p className="local-note">{!navigator.onLine?'Sin conexión · Los cambios se conservan localmente.':status.automatic?'Sincronización automática activa · Los cambios se reciben sin pulsar botones.':'Sincronización automática en espera de sesión o conexión.'} {Object.keys(view.state.baseline).length} registros confirmados.</p>}
      <p>Última sincronización confirmada: {view?.state?.lastConfirmed?new Date(view.state.lastConfirmed).toLocaleString('es-CL'):'Ninguna'}</p>
      <p className="local-note">Solo atributos del catálogo. Stock, costos, imágenes, eventos y ventas permanecen locales. Los productos recibidos requieren conteo físico.</p>
      {view?.state&&role==='administrator'&&<>
        <button type="button" className="button secondary" disabled={busy||!navigator.onLine} onClick={()=>void run(async()=>{const cloud=await client.catalog().read();setRepair({local:await localView(),remote:cloud});setBackupConfirmed(false)})}>Revisar reparación de vinculación</button>
        {repair&&<div className="storage-error">
          <h4>Vista previa de reparación</h4>
          <p>Espacio: {client.workspaceId}. Cuenta vinculada: {repair.local.state?.ownerUid}. Cuenta actual: {uid}.</p>
          <p>Antes de confirmar, guarda un respaldo completo desde Datos y respaldos. No se borran productos, stock, costos ni históricos.</p>
          <label><input type="checkbox" checked={backupConfirmed} onChange={e=>setBackupConfirmed(e.target.checked)}/>Tengo un respaldo de estos datos locales.</label>
          {repair.local.state?.ownerUid!==uid&&<button type="button" className="button secondary" disabled={busy||!backupConfirmed} onClick={()=>void run(async()=>{
            if(!window.confirm('¿Vincular este catálogo a la cuenta administradora actual dentro del mismo espacio? Se conservan pendientes, exclusiones y conflictos; los pendientes autorizados podrán enviarse.'))return
            const access=await client.verify();const cloud=await client.catalog().read()
            await navigator.locks.request('matu-catalog-sync',async()=>{await assertRepairPreview(repair.local,repair.remote,cloud);await adoptCatalogAccount(repair.local,client.workspaceId,uid,access.role)})
            setRepair(undefined);await startCatalog(uid,access.role)
          })}>Confirmar cambio de cuenta vinculada</button>}
          {classificationRepairs(repair.local,repair.remote).map(item=><div key={item.key}>
            <strong>{item.name}</strong><p>Local: {item.key}<br/>Compartida: {item.target}</p>
            <p>Productos que cambiarán de asociación: {item.products.map(p=>p.name).join(', ')||'Ninguno'}.</p>
            <p>La clasificación local se conservará archivada con el sufijo [local UUID]. Se usará la clasificación compartida en estos productos. Las referencias históricas y reglas de promociones existentes conservan sus UUID.</p>
            <button type="button" className="button secondary" disabled={busy||!backupConfirmed||repair.local.state?.ownerUid!==uid} onClick={()=>void run(async()=>{
              if(!window.confirm(`¿Usar la clasificación compartida para ${item.products.length} productos de «${item.name}» y archivar la clasificación local conservando su UUID?`))return
              const access=await client.verify();const cloud=await client.catalog().read()
              await navigator.locks.request('matu-catalog-sync',async()=>{await assertRepairPreview(repair.local,repair.remote,cloud);await repairClassification(repair.local,cloud,item.key,item.target,uid,client.workspaceId,access.role)})
              setRepair(undefined);await startCatalog(uid,access.role)
            })}>Confirmar asociación compartida</button>
          </div>)}
          {!classificationRepairs(repair.local,repair.remote).length&&<p>No hay clasificaciones locales equivalentes con otro UUID remoto.</p>}
          <button type="button" className="button secondary" disabled={busy} onClick={()=>setRepair(undefined)}>Cerrar vista previa</button>
        </div>}
      </>}
      {!view?.state&&<button type="button" className="button secondary" disabled={busy||!navigator.onLine} onClick={()=>void run(compare)}>Vinculación inicial · Comparar</button>}
      {!view?.state&&<p className="local-note">Prepara el catálogo real desde Inventario → Importación masiva · Administración antes de vincular. Los datos de prueba pueden permanecer locales: déjalos excluidos. No se carga automáticamente el catálogo original de 77 productos.</p>}
      {view?.state&&<button type="button" className="button secondary" disabled={busy||!navigator.onLine} onClick={()=>void run(async()=>{await startCatalog(uid,role)})}>Sincronizar catálogo</button>}
      {view?.state&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{
        if(!window.confirm('¿Desvincular este dispositivo? Se conservan los registros locales y cloud. Se bloqueará si hay cambios pendientes.'))return
        stopCatalog();await navigator.locks.request('matu-catalog-sync',()=>unlinkCatalog())
      })}>Desvincular sin borrar datos</button>}
      {!view?.state&&remote&&review&&<>
        <p>Selecciona qué subir o descargar. Por defecto todos los registros quedan excluidos. Coincidencias por nombre con UUID distinto requieren corregir el nombre; no se fusionan identidades históricas.</p>
        <p>{rows.filter(r=>r.status==='local-only'||r.status==='remote-only').length} nuevos · {rows.filter(r=>r.status==='equal').length} coincidentes · {rows.filter(r=>['conflict','name-conflict','invalid'].includes(r.status)).length} conflictos · {choices.filter(c=>c.action==='exclude').length} excluidos</p>
        <p>Cambios propuestos: {choices.filter(c=>c.action==='upload').length} subidas · {choices.filter(c=>c.action==='download').length} descargas.</p>
        <dl>{Object.entries(entityLabels).map(([kind,label])=><div key={kind}><dt>{label}</dt><dd>{Object.keys(review.records).filter(key=>key.startsWith(`${kind}/`)).length} locales · {Object.keys(remote).filter(key=>key.startsWith(`${kind}/`)).length} remotos</dd></div>)}</dl>
        <label>Tipo de registro<select value={entity} onChange={e=>setEntity(e.target.value)}><option value="all">Todos</option>{Object.entries(entityLabels).map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}</select></label>
        <label>Buscar en la comparación<input type="search" value={search} onChange={e=>setSearch(e.target.value)} /></label>
        {canWrite&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{setChoices(includeUploadDependencies(review,remote,choices));setConfirmed(false)})}>Incluir clasificaciones de productos seleccionados</button>}
        <button type="button" className="button secondary" onClick={()=>{setChoices(rows.map(r=>({key:r.key,action:remote[r.key]?'download':'exclude'})));setConfirmed(false)}}>Seleccionar descarga cloud</button>
        <div style={{maxHeight:'45dvh',overflowY:'auto',overflowWrap:'anywhere'}}>{rows.filter(row=>(entity==='all'||row.key.startsWith(`${entity}/`))&&row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(row=><div key={row.key} className="local-note">
          <strong>{row.name}</strong><p>{row.key.split('/')[0]} · {{'local-only':'Solo local','remote-only':'Solo cloud',equal:'Coincidente',conflict:'Diferencias',invalid:'Revisar datos','name-conflict':'Nombre con otro UUID'}[row.status]}</p>
          <p>Precio local: {priceText(review.records[row.key])}</p>
          <p>Precio cloud: {priceText(remote[row.key]?.payload)}</p>
          <details><summary>Ver atributos comparados</summary><div style={{overflowWrap:'anywhere'}}>
            {Object.entries({name:'Nombre',description:'Descripción',categoryId:'Categoría',familyIds:'Familias',ipIds:'IPs',isArchived:'Archivado',isActive:'Activo',isFavorite:'Destacado',order:'Orden',kind:'Tipo'}).map(([field,label])=>{
              const local=review.records[row.key] as Record<string,unknown>|undefined,cloud=remote[row.key]?.payload as Record<string,unknown>|undefined
              if(local?.[field]===undefined&&cloud?.[field]===undefined)return null
              const display=(value:unknown)=>Array.isArray(value)?value.join(', '):typeof value==='boolean'?(value?'Sí':'No'):String(value??'—')
              return <p key={field}><strong>{label}</strong><br/>Local: {display(local?.[field])}<br/>Cloud: {display(cloud?.[field])}</p>
            })}
          </div></details>
          <label>Acción para {row.name}<select value={choices.find(c=>c.key===row.key)?.action??'exclude'} disabled={busy} onChange={e=>{setChoices(previous=>previous.map(c=>c.key===row.key?{...c,action:e.target.value as Choice['action']}:c));setConfirmed(false)}}>
            <option value="exclude">Excluir · conservar local</option>
            {canWrite&&review.records[row.key]&&<option value="upload">Subir versión local</option>}
            {remote[row.key]&&<option value="download">Descargar versión cloud</option>}
          </select></label>
        </div>)}</div>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />Confirmo los cambios seleccionados. Las descargas reemplazan solo atributos del catálogo; las subidas seleccionadas se enviarán a Firestore.</label>
        <button type="button" className="button primary" disabled={busy||!confirmed} onClick={()=>void run(async()=>{
          const latest=await client.catalog().read()
          if(JSON.stringify(latest)!==JSON.stringify(remote))throw new Error('El catálogo cloud cambió. Vuelve a comparar.')
          await linkCatalog(review,remote,choices,client.workspaceId,uid,canWrite);setRemote(undefined);await startCatalog(uid,role)
        })}>Confirmar vinculación</button>
        <button type="button" className="button secondary" disabled={busy} onClick={()=>{setRemote(undefined);setChoices([]);setConfirmed(false)}}>Cancelar sin cambios</button>
      </>}
      {Object.entries(view?.state?.conflicts??{}).map(([key,message])=><div key={key} className="storage-error"><p>{view?.records[key]?.name??key}: {message}</p>
        {!status.remote?.[key] && <p>No existe una versión cloud con este UUID. Si el nombre ya existe en la nube, «Usar local» no resuelve la coincidencia: revisa ambas identidades antes de volver a enviar. No crees otra clasificación con el mismo nombre.</p>}
        <details><summary>Comparar versiones del conflicto</summary><p>Local</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(view?.records[key]??null,null,2)}</pre><p>Cloud · revisión {status.remote?.[key]?.revision??'sin lectura actual'}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(status.remote?.[key]?.payload??null,null,2)}</pre></details>
        {(['remote','local','exclude'] as const).filter(action=>action==='local'?canWrite&&!!view?.records[key]:action==='remote'?!!status.remote?.[key]:true).map(action=><button key={action} type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{
          if(!window.confirm(action==='exclude'?'¿Excluir este registro de la sincronización conservando sus datos locales?':`¿Resolver el conflicto usando la versión ${action==='local'?'local':'cloud'}?`))return
          const current=await client.catalog().read();await resolveConflict(key,action,current,canWrite);await startCatalog(uid,role)
        })}>{{remote:'Usar cloud',local:'Usar local',exclude:'Excluir'}[action]}</button>)}
      </div>)}
      {Object.keys(view?.state?.pending??{}).length>0&&<details><summary>Revisar cambios pendientes</summary>{Object.entries(view?.state?.pending??{}).map(([key,pending])=><p key={key}>{pending.payload.name} <button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{
        if(!window.confirm('¿Excluir este cambio de futuros envíos? Los datos locales se conservarán. Si el servidor ya lo confirmó, no se borrará allí.'))return
        await resolveConflict(key,'exclude',{},canWrite)
      })}>Excluir de sincronización</button></p>)}</details>}
      {status.busy&&<p role="status">Comprobando catálogo…</p>}
      {(error||status.error)&&<p role="alert" className="storage-error">{error||status.error}</p>}
    </>}
  </section>
}
