import '../../styles/data.css'
import { useRef, useState } from 'react'
import { artisticAssets } from '../../assets/artisticAssets'
import { canShare, downloadFile, generateFile, shareFile } from '../../services/data/download'
export function ReportButton({eventId}:{eventId:string}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[file,setFile]=useState<Blob>()
  const lock=useRef(false), filename=`MATU-ART-evento-${eventId}.pdf`
  async function generate(){if(lock.current)return;lock.current=true;setBusy(true);setError('');setFile(undefined);try{const response=await fetch(artisticAssets.brandLogo);if(!response.ok)throw new Error('No se pudo cargar el logo local.');setFile(await generateFile({kind:'pdf',eventId,logo:new Uint8Array(await response.arrayBuffer())}))}catch(e){setError(e instanceof Error?e.message:'No se pudo crear el PDF.')}finally{lock.current=false;setBusy(false)}}
  return <div className="report-actions"><button className="button secondary" disabled={busy} onClick={()=>{void generate()}}>{busy?'Generando PDF…':'Exportar informe PDF'}</button>{file&&<><button className="button primary" onClick={()=>{try{downloadFile(file,filename)}catch(e){setError(e instanceof Error?e.message:'No se pudo solicitar la descarga del PDF.')}}}>Descargar PDF</button>{canShare(file,filename)&&<button className="button secondary" onClick={()=>{void shareFile(file,filename).catch(e=>setError(e instanceof Error?e.message:'No se pudo compartir.'))}}>Compartir PDF</button>}<small role="status">Informe generado. Descárgalo y comprueba que se guardó.</small></>}{error&&<p role="alert" className="storage-error">{error}</p>}</div>
}
