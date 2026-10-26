import { readData } from './snapshot.ts'
import { exportTables, type ExportFilters } from './exportTables.ts'
import { createBackup } from './backup.ts'
export type FileJob = {kind:'backup'} | {kind:'csv'|'xlsx';filters:ExportFilters} | {kind:'pdf';eventId:string;logo:Uint8Array}
self.onmessage=async (event:MessageEvent<FileJob>)=>{
  try {
    const job=event.data, data=await readData()
    let file:Blob
    if(job.kind==='backup') file=new Blob([await createBackup(data)],{type:'application/json'})
    else if(job.kind==='pdf') {const {eventPDF}=await import('./eventPDF.ts');file=eventPDF(data,job.eventId,job.logo)}
    else {const {excelFile,csvArchive}=await import('./fileFormats.ts'); const tables=exportTables(data,job.filters);file=await(job.kind==='csv'?csvArchive(tables):excelFile(tables))}
    self.postMessage({file})
  } catch(error) {self.postMessage({error:error instanceof Error?error.message:'No se pudo generar el archivo.'})}
}
