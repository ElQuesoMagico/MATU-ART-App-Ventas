import type { FileJob } from './files.worker'
import type { RestoreJob } from './restore.worker'
import type { prepareRestore } from './backup'
type RestorePreview=Awaited<ReturnType<typeof prepareRestore>>
export function processRestore(job:RestoreJob):Promise<RestorePreview|undefined> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./restore.worker.ts',import.meta.url),{type:'module'})
    worker.onmessage=(event:MessageEvent<{result?:RestorePreview;error?:string}>)=>{worker.terminate();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.result)}
    worker.onerror=()=>{worker.terminate();reject(new Error('No se pudo procesar el respaldo. Revisa el almacenamiento disponible.'))}
    worker.postMessage(job)
  })
}
export function generateFile(job:FileJob):Promise<Blob> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./files.worker.ts',import.meta.url),{type:'module'})
    worker.onmessage=(event:MessageEvent<{file?:Blob;error?:string}>)=>{worker.terminate();if(event.data.file)resolve(event.data.file);else reject(new Error(event.data.error))}
    worker.onerror=()=>{worker.terminate();reject(new Error('La generación no pudo completarse. Revisa el espacio disponible y prueba un período menor.'))}
    worker.postMessage(job)
  })
}
export function downloadFile(file:Blob,name:string) {
  const url=URL.createObjectURL(file), a=document.createElement('a')
  try{a.href=url;a.download=name;document.body.append(a);a.click()}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000)}
}
export function canShare(file:Blob,name:string) {return typeof navigator.canShare==='function'&&navigator.canShare({files:[new File([file],name,{type:file.type})]})}
export async function shareFile(file:Blob,name:string) {await navigator.share({files:[new File([file],name,{type:file.type})],title:'MATU ART'})}
