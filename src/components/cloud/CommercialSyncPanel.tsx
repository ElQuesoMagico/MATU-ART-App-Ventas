import { useEffect, useRef, useState } from 'react'
import type { FirebaseRole } from '../../services/firebase/access'
import { firebaseConnection } from '../../services/firebase/client'
import { commercialView, linkCommercial, resolveConfiguration } from '../../services/firebase/commercial/commercialLocal'
import type { CommercialConfiguration, ConfigurationRecord } from '../../services/firebase/commercial/commercialState'
import { commercialStatus, startCommercial, wakeCommercial } from '../../services/firebase/commercial/commercialRuntime'
import { notifyInventory } from '../../services/firebase/commercial/inventoryRuntime'
export function CommercialSyncPanel({uid,role}:{uid:string;role:FirebaseRole}){
  const client=firebaseConnection(),[view,setView]=useState<Awaited<ReturnType<typeof commercialView>>>(),[remote,setRemote]=useState<ConfigurationRecord|null>(),[token,setToken]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false)
  useEffect(()=>{let active=true;const refresh=()=>{void commercialView().then(v=>{if(active)setView(v)}).catch(e=>{if(active)setError(String(e))})};refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)}},[])
  if(!client?.commercialEnabled)return null
  async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();setView(await commercialView());notifyInventory();wakeCommercial()}catch(e){setError(e instanceof Error?e.message:'No se completó la operación.')}finally{lock.current=false;setBusy(false)}}
  const summary=(c:CommercialConfiguration)=>`${c.events.length} eventos · ${c.promotions.length} promociones · ${c.expenses.length} gastos · ${c.eventPrices.length} productos con precios por evento`
  const state=view?.state,pending=state?.operations.filter(o=>o.state!=='confirmed')??[]
  async function compare(){const access=await client!.verify();if(client!.identity()!==uid)throw new Error('La sesión cambió.');startCommercial(uid,access.role);const latest=await commercialView();setView(latest);setToken(latest.token);setRemote(await client!.commercial().configuration.read());setAccepted(false)}
  return <section className="data-manager"><h3>Eventos y ventas compartidas</h3>
    <p>{state?`${pending.length} ventas o anulaciones pendientes · ${state.configurationPending?'Configuración pendiente':state.configurationConflict?'Configuración en revisión':'Configuración vinculada'}`:'Revisa la configuración antes de vincular. No se suben ventas antiguas ni existencias.'}</p>
    <p className="local-note">{navigator.onLine?'Los registros nuevos se comparten automáticamente después de vincular.':'Sin conexión. Las operaciones guardadas permanecen pendientes.'}</p>
    <button className="button secondary" disabled={busy||!navigator.onLine} onClick={()=>void run(compare)}>Comparar configuración comercial</button>
    {remote!==undefined&&view&&<div className="cost-summary"><p>Este dispositivo: {summary(view.local)}</p><p>Compartido: {remote?summary(remote.payload):'Sin configuración'}</p>
      <p>Evento local: {view.local.events.find(e=>e.status==='active')?.name??'Ninguno'} · Compartido: {remote?.payload.events.find(e=>e.status==='active')?.name??'Ninguno'}</p>
      <details><summary>Ver registros antes de confirmar</summary><p>Eventos locales: {view.local.events.map(e=>e.name).join(', ')||'Ninguno'}</p><p>Eventos compartidos: {remote?.payload.events.map(e=>e.name).join(', ')||'Ninguno'}</p><p>Promociones locales: {view.local.promotions.map(p=>p.name).join(', ')||'Ninguna'}</p><p>Gastos locales: {view.local.expenses.map(e=>e.concept).join(', ')||'Ninguno'}</p></details>
      <label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> Revisé estos registros y confirmo la configuración seleccionada. Las ventas históricas y cantidades no se incorporan.</label>
      {!state&&<button className="button primary" disabled={busy||!accepted||(!remote&&role==='seller')} onClick={()=>void run(async()=>{const access=await client!.verify();const fresh=await client!.commercial().configuration.read();if(JSON.stringify(fresh)!==JSON.stringify(remote))throw new Error('La nube cambió; compara nuevamente.');await linkCommercial(token,fresh,remote?'remote':'local',uid,client!.workspaceId,access.role!=='seller');setRemote(undefined)})}>{remote?'Recibir configuración y vincular':'Compartir configuración revisada'}</button>}
      {state?.configurationConflict&&remote&&role!=='seller'&&<><button className="button secondary" disabled={busy||!accepted} onClick={()=>void run(async()=>{await resolveConfiguration(remote,'remote',uid,token);setRemote(undefined)})}>Usar versión compartida</button><button className="button secondary" disabled={busy||!accepted} onClick={()=>void run(async()=>{await resolveConfiguration(remote,'local',uid,token);setRemote(undefined)})}>Conservar versión local y compartir</button></>}
    </div>}
    {!!pending.length&&<details><summary>Operaciones pendientes ({pending.length})</summary>{pending.map(op=><p key={op.kind==='sale'?op.intent.sale.operationId:op.intent.operationId}>{op.kind==='sale'?`Venta ${op.intent.sale.number}`:'Anulación'} · {op.error??'Guardada en este dispositivo; esperando confirmación.'}</p>)}</details>}
    {(error||state?.configurationError||commercialStatus().error)&&<p role="alert" className="storage-error">{error||state?.configurationError||commercialStatus().error}</p>}
  </section>
}
