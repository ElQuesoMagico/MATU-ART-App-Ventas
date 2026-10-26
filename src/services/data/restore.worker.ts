import { prepareRestore, restoreBackup } from './backup.ts'
import type { DataSnapshot } from './snapshot.ts'
export type RestoreJob={kind:'preview';text:string}|{kind:'restore';data:DataSnapshot;token:string}
self.onmessage=async(event:MessageEvent<RestoreJob>)=>{
  try{const job=event.data;const result=job.kind==='preview'?await prepareRestore(job.text):await restoreBackup(job.data,job.token);self.postMessage({result})}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'No se pudo procesar el respaldo.'})}
}
