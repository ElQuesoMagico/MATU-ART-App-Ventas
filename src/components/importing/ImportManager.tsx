import { useRef, useState } from 'react'
import { Modal } from '../Modal'
import type { ImportKind, ImportSource } from '../../types/imports'
import { readImport } from '../../services/importing/parse'
import { buildImportPlan, type ImportPlan, type ImportChoices } from '../../services/importing/plan'
import { applyImport } from '../../services/importing/apply'
import { readData, type DataSnapshot } from '../../services/data/snapshot'
import { createBackup } from '../../services/data/backup'
import { downloadFile } from '../../services/data/download'
import { reviewedChoices } from '../../services/importing/reviewed'
import { money } from '../../utils/format'
const labels:Record<ImportKind,string>={catalog:'Catálogo maestro',families:'Familias',ips:'IPs',sales:'Ventas históricas'}
export function ImportManager({onClose}:{onClose:()=>void}) {
  const [sources,setSources]=useState<Partial<Record<ImportKind,ImportSource>>>({}),[base,setBase]=useState<DataSnapshot>(),[plan,setPlan]=useState<ImportPlan>(),[choices,setChoices]=useState<ImportChoices>({})
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState(''),[ack,setAck]=useState(false)
  const identities=useRef<Record<string,string>>({}),lock=useRef(false)
  async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action()}catch(e){setError(e instanceof Error?e.message:'No se pudo completar la operación.')}finally{lock.current=false;setBusy(false)}}
  const list=Object.values(sources) as ImportSource[]
  function choose(key:string,value:string){const next={...choices,[key]:value};setChoices(next);setConfirmation('');setAck(false);if(base)setPlan(buildImportPlan(base,list,next,identities.current))}
  return <Modal title="Importación inicial" onClose={onClose} busy={busy} protectChanges hasChanges={!!plan&&!notice}><div className="data-manager">
    <p>Administración local · No envía archivos a la nube ni cambia la sesión. El acceso al dispositivo determina quién puede administrar estos datos.</p>
    <p className="stock-warning">Sin inventario físico confirmado. Los productos nuevos quedarán pendientes de conteo; las ventas históricas no descontarán stock ni crearán movimientos.</p>
    {(Object.keys(labels) as ImportKind[]).map(kind=><label key={kind}>{labels[kind]} · CSV / TSV UTF-8<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(!file)return;void run(async()=>{if(file.size>5*1024*1024)throw new Error('El archivo supera el limite de 5 MB.');const source=await readImport(kind,file.name,new Uint8Array(await file.arrayBuffer()));setSources(current=>({...current,[kind]:source}));setPlan(undefined);setBase(undefined);setConfirmation('');setAck(false);setNotice('')})}} />{sources[kind]&&<small>{sources[kind]!.rows.length} filas · {sources[kind]!.name}</small>}</label>)}
    <button className="button secondary" disabled={busy||!list.length} onClick={()=>void run(async()=>{const snapshot=await readData();setBase(snapshot);setPlan(buildImportPlan(snapshot,list,choices,identities.current));setConfirmation('');setAck(false);setNotice('')})}>Generar vista previa</button>
    {plan&&<>
      <dl className="backup-counts"><div><dt>Filas leídas</dt><dd>{plan.sourceRows}</dd></div><div><dt>Ya importadas</dt><dd>{plan.alreadyImported}</dd></div><div><dt>Productos nuevos / pendientes de conteo</dt><dd>{plan.additions.products.length}</dd></div><div><dt>Filas pendientes, excluidas</dt><dd>{plan.deferredRows}</dd></div><div><dt>Registros históricos resueltos</dt><dd>{plan.additions.sales.length}</dd></div><div><dt>Unidades resueltas</dt><dd>{plan.units}</dd></div><div><dt>Ingresos resueltos</dt><dd>{money(plan.income)}</dd></div></dl>
      <p>Se conservarán stock, precios, costos y archivo de todos los productos locales. Cada fila de ventas se registrará por separado; el número de transacciones originales se desconoce.</p>
      <details><summary>Alcance de clasificaciones y eventos</summary>{(['categories','families','ips','managedEvents'] as const).map(kind=><p key={kind}>{kind}: {plan.additions[kind].map(item=>item.name).join(', ')||'Sin altas'}</p>)}</details>
      <details><summary>Correspondencias y precios ({plan.additions.importRecords.filter(r=>r.kind==='catalog').length})</summary>{plan.additions.importRecords.filter(r=>r.kind==='catalog').map(r=>{const p=[...(base?.products??[]),...plan.additions.products].find(p=>p.id===r.targetId);return <p key={r.id}>{r.original.Nombres} → {p?.name} · Origen ${r.original.Precios} / local ${p?.price} · {p?.stockCountPending?'Pendiente de conteo':'Stock conservado'}</p>})}</details>
      {plan.warnings.length>0&&<details open><summary>Advertencias ({plan.warnings.length})</summary>{plan.warnings.map(w=><p key={w}>{w}</p>)}</details>}
      {Object.keys(reviewedChoices(list,[...(base?.products??[]),...plan.additions.products])).length>0&&<button className="button secondary" disabled={busy} onClick={()=>{if(!base)return;const next={...choices,...reviewedChoices(list,[...base.products,...plan.additions.products])};setChoices(next);setPlan(buildImportPlan(base,list,next,identities.current));setConfirmation('');setAck(false)}}>Aplicar correspondencias revisadas del CSV original</button>}
      <details><summary>Fechas y pagos de origen</summary>{list.filter(s=>s.kind==='sales').map(s=><div key={s.hash}><p>{s.rows.length} filas · {s.rows.map(r=>r.Fecha).sort()[0]} / {s.rows.map(r=>r.Fecha).sort().at(-1)}</p><p>Eventos: {[...new Set(s.rows.map(r=>r.Evento))].join(', ')}</p><p>Medios: {[...new Set(s.rows.map(r=>r.Metodo_Pago))].join(', ')}</p></div>)}</details>
      {plan.issues.length>0&&<section aria-label="Discrepancias"><h3>Revisar antes de importar ({plan.issues.length})</h3>{plan.issues.map(issue=><label key={issue.key}>{issue.message}{issue.options?<select value={choices[issue.key]??''} onChange={e=>choose(issue.key,e.target.value)}><option value="">Selecciona una correspondencia</option>{issue.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>:issue.text?<input defaultValue={choices[issue.key]??''} onBlur={e=>choose(issue.key,e.target.value)} />:<span className="storage-error">Corrige el archivo original en una copia y vuelve a seleccionarla.</span>}</label>)}</section>}
      <button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{const json=await createBackup(await readData());downloadFile(new Blob([json],{type:'application/json'}),'MATU-ART-antes-importacion.json')})}>Descargar respaldo antes de importar</button>
      <label className="check-label"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} />He revisado correspondencias, advertencias y el alcance como responsable de estos datos.</label>
      <label>Escribe IMPORTAR para confirmar<input autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} /></label>
      <button className="button primary" disabled={busy||!!plan.issues.length||!plan.additions.importRecords.length||!ack||confirmation!=='IMPORTAR'} onClick={()=>void run(async()=>{const result=await applyImport(plan);setNotice(`Importación finalizada: ${result.products} productos, ${result.sales} registros históricos. Sin movimientos de stock. ${plan.deferredRows} filas quedan pendientes.`);setPlan(undefined);setConfirmation('');setAck(false)})}>Aplicar importación local</button>
    </>}
    {busy&&<p role="status">Procesando…</p>}{error&&<p className="storage-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </div></Modal>
}
