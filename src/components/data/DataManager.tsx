import { useRef, useState } from 'react'
import { Modal } from '../Modal'
import { useCatalog } from '../../hooks/useCatalog'
import { canShare, downloadFile, generateFile, shareFile, processRestore } from '../../services/data/download'
import type { prepareRestore } from '../../services/data/backup'
import type { ExportFilters } from '../../services/data/exportTables'
import { historyEventOptions } from '../../services/eventRules'
import { santiagoDay } from '../../utils/format'
import '../../styles/data.css'
import { useOfflineStatus } from '../../services/offlineStatus'
const entityLabels:Record<string,string>={products:'Productos',categories:'Categorías',families:'Familias',ips:'IPs',movements:'Movimientos',costChanges:'Cambios de costo',sales:'Ventas',payments:'Pagos',metadata:'Configuración',events:'Eventos históricos',managedEvents:'Eventos',promotions:'Promociones y combos',expenses:'Gastos',expenseCategories:'Categorías de gasto',expenseChanges:'Auditoría de gastos'}
type Preview=Awaited<ReturnType<typeof prepareRestore>>
export function DataManager({onClose,onCloud}:{onClose:()=>void;onCloud?:()=>void}) {
  const catalog=useCatalog(),lock=useRef(false)
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const offlineStatus=useOfflineStatus()
  const [filters,setFilters]=useState<ExportFilters>({productState:'all'}),[ready,setReady]=useState<{file:Blob;name:string}>(),[preview,setPreview]=useState<Preview>(),[confirmation,setConfirmation]=useState('')
  const setFilter=<K extends keyof ExportFilters>(key:K,value:ExportFilters[K])=>setFilters(previous=>({...previous,[key]:value}))
  async function run(message:string,fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(message);setError('');setNotice('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'No se pudo completar la operación.')}finally{lock.current=false;setBusy('')}}
  function generate(kind:'backup'|'csv'|'xlsx'){void run('Generando archivo…',async()=>{setReady(undefined);const file=await generateFile(kind==='backup'?{kind}:{kind,filters});setReady({file,name:`MATU-ART-${kind==='backup'?'respaldo':'datos'}-${santiagoDay(new Date().toISOString())}.${kind==='backup'?'json':kind==='csv'?'zip':'xlsx'}`});setNotice('Archivo listo. Descárgalo y comprueba que se guardó en tu dispositivo.')})}
  function load(file?:File){setPreview(undefined);setConfirmation('');if(!file)return;void run('Validando respaldo…',async()=>{if(file.size>128*1024*1024)throw new Error('El archivo supera 128 MB.');setPreview(await processRestore({kind:'preview',text:await file.text()}))})}
  function restore(){if(!preview||confirmation!=='RESTAURAR')return;void run('Restaurando y verificando…',async()=>{await processRestore({kind:'restore',data:preview.data,token:preview.localToken});try{const channel=new BroadcastChannel('clown-ufo-catalog');channel.postMessage('restored');channel.close()}catch{/* focus refresh available */}setPreview(undefined);setConfirmation('');await catalog.reload();setNotice('Restauración completada y verificada. Se recargará la aplicación para descartar formularios y carrito anteriores.');window.location.reload()})}
  const options=historyEventOptions(catalog.realEvents,catalog.sales)
  return <Modal title="Datos y respaldos" onClose={onClose} busy={!!busy} protectChanges hasChanges={!!preview}><div className="data-manager">
    <div className="data-actions">{onCloud&&<button className="button secondary" disabled={!!busy||!!preview} onClick={onCloud}>Conexión a la nube</button>}</div>
    <p>Archivos locales de MATU ART. Guárdalos en un lugar seguro; no se envían a la nube.</p>
    <p className="local-note" role="status">{offlineStatus}</p>
    {busy&&<p role="status" aria-live="polite">{busy}</p>}{error&&<p role="alert" className="storage-error">{error}</p>}{notice&&<p role="status" className="save-notice">{notice}</p>}
    <fieldset disabled={!!busy}><legend>Exportaciones</legend><div className="data-filter-grid">
      <label>Evento<select value={filters.eventId??'all'} onChange={e=>setFilter('eventId',e.target.value)}><option value="all">Todos los eventos</option><option value="none">Sin evento / gastos globales</option>{options.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label>Productos<select value={filters.productState} onChange={e=>setFilter('productState',e.target.value as ExportFilters['productState'])}><option value="all">Activos y archivados</option><option value="active">Activos</option><option value="archived">Archivados</option></select></label>
      <label>Ventas desde<input type="date" value={filters.saleStart??''} onChange={e=>setFilter('saleStart',e.target.value)} /></label><label>Ventas hasta<input type="date" value={filters.saleEnd??''} onChange={e=>setFilter('saleEnd',e.target.value)} /></label>
    </div><details><summary>Filtrar movimientos</summary><div className="data-filter-grid"><label>Producto<select value={filters.movementProductId??''} onChange={e=>setFilter('movementProductId',e.target.value)}><option value="">Todos los productos</option>{catalog.products.map(p=><option key={p.id} value={p.id}>{p.name}{p.isArchived?' · Archivado':''}</option>)}</select></label><label>Desde<input type="date" value={filters.movementStart??''} onChange={e=>setFilter('movementStart',e.target.value)} /></label><label>Hasta<input type="date" value={filters.movementEnd??''} onChange={e=>setFilter('movementEnd',e.target.value)} /></label></div></details>
    <p className="local-note">Cada filtro afecta solo su entidad. Los productos referenciados se conservan y se identifican en la exportación. El período de ventas no recorta gastos.</p>
    <div className="data-actions"><button className="button secondary" onClick={()=>generate('csv')}>Generar CSV (ZIP)</button><button className="button primary" onClick={()=>generate('xlsx')}>Generar Excel</button><button className="text-button" onClick={()=>setFilters({productState:'all'})}>Limpiar filtros</button></div></fieldset>
    <fieldset disabled={!!busy}><legend>Respaldo completo</legend><p>Incluye todos los datos, imágenes y auditorías. Los filtros de exportación no se aplican al respaldo.</p><button className="button primary" onClick={()=>generate('backup')}>Crear respaldo JSON</button></fieldset>
    {ready&&<section className="file-ready" aria-label="Archivo generado"><strong>{ready.name}</strong><small>{(ready.file.size/1024).toFixed(1)} KB</small><div className="data-actions"><button className="button primary" disabled={!!busy} onClick={()=>{try{downloadFile(ready.file,ready.name);setNotice('Descarga solicitada. Comprueba el archivo en las descargas del navegador.')}catch(e){setError(e instanceof Error?e.message:'No se pudo descargar.')}}}>Descargar archivo</button>{canShare(ready.file,ready.name)&&<button className="button secondary" disabled={!!busy} onClick={()=>{void run('Compartiendo…',()=>shareFile(ready.file,ready.name))}}>Compartir</button>}</div></section>}
    <fieldset disabled={!!busy}><legend>Restaurar respaldo</legend><p>Reemplaza todos los datos de este navegador. Primero guarda un respaldo actual y cierra MATU ART en las otras pestañas. El carrito temporal se descartará al terminar.</p><label>Archivo JSON<input type="file" accept=".json,application/json" onChange={e=>load(e.target.files?.[0])} /></label>
    {preview&&<><p>Respaldo validado · {preview.generatedAt}</p><details open><summary>Registros: locales → respaldo</summary><dl className="backup-counts">{Object.entries(preview.counts).map(([key,count])=><div key={key}><dt>{entityLabels[key]??key}</dt><dd>{preview.localCounts[key]} → {count}</dd></div>)}</dl></details><div className="stock-warning"><p>Se reemplazarán los datos locales, incluidas las imágenes y el historial. Esta acción no combina bases.</p><label>Escribe RESTAURAR para confirmar<input autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} /></label><div className="data-actions"><button className="button secondary" onClick={()=>{setPreview(undefined);setConfirmation('')}}>Cancelar restauración</button><button className="button primary" disabled={confirmation!=='RESTAURAR'} onClick={restore}>Reemplazar datos locales</button></div></div></>}
    </fieldset>
  </div></Modal>
}
