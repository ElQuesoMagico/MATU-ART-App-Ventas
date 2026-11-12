import type { CatalogProduct } from '../../../types/catalog.ts'
import { stable } from '../catalogModel.ts'
import { inventoryView, linkInventory, type InventorySelection } from './inventoryLocal.ts'
import type { InventoryBalance } from './inventoryProtocol.ts'

export type OpeningMode = 'unknown' | 'count'
export interface OpeningResult { productId: string; status: 'queued' | 'received' | 'already' | 'error'; error?: string }
export function selectInventory(products: CatalogProduct[], included: string[], remote: Record<string, InventoryBalance>, mode: OpeningMode, canWrite: boolean): Record<string, InventorySelection> {
  return Object.fromEntries(products.filter(p => !p.isArchived && !included.includes(p.id) && (canWrite || remote[p.id])).map(p => [p.id, {
    productId:p.id, action:remote[p.id]?'receive':mode,
    ...(mode==='count'&&!remote[p.id]&&!p.stockCountPending?{quantity:p.stock}:{}),
  }]))
}
export function openingSummary(choices: Record<string, InventorySelection>) {
  const rows=Object.values(choices)
  return { total:rows.length, unknown:rows.filter(r=>r.action==='unknown').length, receive:rows.filter(r=>r.action==='receive').length,
    counts:rows.filter(r=>r.action==='count'), invalid:rows.some(r=>r.action==='count'&&(!Number.isSafeInteger(r.quantity)||Math.abs(r.quantity!)>1000000000)) }
}
/** One atomic durable transaction per product. Resume skips committed products; queued UUIDs never change.
 * Caller holds matu-inventory-write. Network delivery uses the existing serialized outbox, not a bulk write.
 */
export async function shareInventoryBatch(selections: InventorySelection[], remote: Record<string, InventoryBalance>, preview: Awaited<ReturnType<typeof inventoryView>>, workspace: string, uid: string, canWrite: boolean, progress: (results: OpeningResult[])=>void, name?: string) {
  if(new Set(selections.map(s=>s.productId)).size!==selections.length)throw new Error('Hay productos repetidos en la selección.')
  const results:OpeningResult[]=[]
  for(const selection of selections){
    try {
      const current=await inventoryView(name)
      if(current.state&&(current.state.ownerUid!==uid||current.state.workspaceId!==workspace))throw new Error('La cuenta o el espacio cambió.')
      if(current.state?.products.includes(selection.productId))results.push({productId:selection.productId,status:'already'})
      else {
        const original=preview.products.find(p=>p.id===selection.productId),product=current.products.find(p=>p.id===selection.productId)
        if(!original||!product||stable(original)!==stable(product))throw new Error('El producto cambió. Compara nuevamente antes de compartirlo.')
        await linkInventory([selection],remote,current.token,workspace,uid,canWrite,name)
        results.push({productId:selection.productId,status:selection.action==='receive'?'received':'queued'})
      }
    }catch(error){results.push({productId:selection.productId,status:'error',error:error instanceof Error?error.message:'No se pudo preparar este producto.'})}
    progress([...results])
    // Yield to paint progress on large catalogs; committed operations survive closing the tab.
    await new Promise(resolve=>setTimeout(resolve,0))
  }
  return results
}
