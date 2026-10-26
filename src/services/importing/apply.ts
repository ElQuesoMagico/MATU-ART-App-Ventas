import { openCatalogDatabase } from '../catalogDatabase.ts'
import { assertNoPendingOperations, snapshotToken, stores, type DataSnapshot } from '../data/snapshot.ts'
import { validateData } from '../data/backupValidation.ts'
import type { ImportPlan } from './plan.ts'
export async function applyImport(plan:ImportPlan,name?:string) {
  if(plan.issues.length)throw new Error('Resuelve los errores antes de importar.')
  const db=await openCatalogDatabase(name),tx=db.transaction([...stores],'readwrite'),done=tx.done;void done.catch(()=>{})
  try {
    const current=Object.fromEntries(await Promise.all(stores.map(async s=>[s,await tx.objectStore(s).getAll()]))) as DataSnapshot
    if(snapshotToken(current)!==plan.baseToken)throw new Error('Los datos locales cambiaron. Genera otra vista previa.')
    assertNoPendingOperations(current)
    const merged=Object.fromEntries(stores.map(s=>[s,[...current[s],...plan.additions[s]]])) as DataSnapshot
    merged.metadata=current.metadata.filter(m=>m.key!=='sale-number')
    merged.metadata.push({key:'sale-number',value:plan.nextNumber})
    validateData(merged)
    for(const s of stores)if(s!=='metadata')for(const row of plan.additions[s])await tx.objectStore(s).add(row)
    await tx.objectStore('metadata').put({key:'sale-number',value:plan.nextNumber})
    await done
    if(typeof window!=='undefined'){window.dispatchEvent(new Event('catalog-updated'));const channel=new BroadcastChannel('clown-ufo-catalog');channel.postMessage('changed');channel.close()}
    return {products:plan.additions.products.length,sales:plan.additions.sales.length,records:plan.additions.importRecords.length}
  }catch(error){try{tx.abort()}catch{/* completed/aborted */}await done.catch(()=>{});throw error}finally{db.close()}
}
