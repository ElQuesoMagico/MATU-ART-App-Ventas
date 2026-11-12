import type { IDBPTransaction } from 'idb'
import { openCatalogDatabase, type CatalogSchema } from '../../catalogDatabase.ts'
import { stable } from '../catalogModel.ts'
import { validateConfiguration } from './configuration.ts'
import type { CommercialConfiguration, CommercialState, ConfigurationRecord } from './commercialState.ts'
import type { ReceivedSale } from './saleRemote.ts'
import { validateSaleReceipt } from './saleRemote.ts'
import { calculateSaleStock } from '../../saleRules.ts'
const names = ['categories','families','ips','products','managedEvents','promotions','expenses','expenseCategories','expenseChanges','metadata','commercialSync','catalogSync','inventorySync','sales','payments','movements'] as const
type Tx = IDBPTransaction<CatalogSchema, typeof names, 'readwrite'>
async function write<T>(name: string | undefined, action: (tx: Tx) => Promise<T>) {
  const db = await openCatalogDatabase(name), tx = db.transaction(names, 'readwrite'); void tx.done.catch(() => {})
  try { const result = await action(tx); await tx.done; return result } catch (error) { try { tx.abort() } catch { /* completed */ } await tx.done.catch(() => {}); throw error } finally { db.close() }
}
async function configuration(tx: Tx): Promise<CommercialConfiguration> {
  const [events,promotions,expenses,expenseCategories,expenseChanges,products] = await Promise.all([tx.objectStore('managedEvents').getAll(),tx.objectStore('promotions').getAll(),tx.objectStore('expenses').getAll(),tx.objectStore('expenseCategories').getAll(),tx.objectStore('expenseChanges').getAll(),tx.objectStore('products').getAll()])
  return validateConfiguration({ events,promotions,expenses,expenseCategories,expenseChanges,packs:products.filter(p=>p.kind==='pack').map(p=>({productId:p.id,contents:p.packContents??[]})),eventPrices: products.filter(p => p.eventPrices?.length).map(p => ({ productId:p.id, prices:p.eventPrices! })) })
}
export async function commercialView(name?: string) { return write(name, async tx => { const local = await configuration(tx), state = await tx.objectStore('commercialSync').get('commerce'); return { local, state, token: stable({local,state}) } }) }
async function applyConfiguration(tx: Tx, payload: CommercialConfiguration) {
  validateConfiguration(payload)
  for (const promotion of payload.promotions) {
    const references = [
      ...promotion.productIds.map(id => ({store:'products' as const,id})),
      ...promotion.categoryIds.map(id => ({store:'categories' as const,id})),
      ...promotion.familyIds.map(id => ({store:'families' as const,id})),
      ...promotion.ipIds.map(id => ({store:'ips' as const,id})),
      ...(promotion.components??[]).map(c => ({store:c.kind==='product'?'products' as const:'categories' as const,id:c.targetId})),
    ]
    for (const reference of references) if (!await tx.objectStore(reference.store).get(reference.id))
      throw new Error(`Espera la recepción del catálogo: falta una referencia de la promoción «${promotion.name}».`)
  }
  // Never delete local entities. A remote omission is not a deletion instruction.
  const current = await configuration(tx)
  const incomingActive = payload.events.find(e => e.status === 'active')?.id
  for (const e of current.events) if (e.status === 'active' && e.id !== incomingActive) await tx.objectStore('managedEvents').put({ ...e, status: 'upcoming', activeKey: undefined })
  for (const e of payload.events) await tx.objectStore('managedEvents').put(e)
  for (const p of payload.promotions) await tx.objectStore('promotions').put(p)
  for (const c of payload.expenseCategories) await tx.objectStore('expenseCategories').put(c)
  for (const e of payload.expenses) await tx.objectStore('expenses').put(e)
  for (const c of payload.expenseChanges) await tx.objectStore('expenseChanges').put(c)
  for(const pack of payload.packs){const product=await tx.objectStore('products').get(pack.productId);if(!product||product.kind!=='pack')throw new Error('Espera la recepción del catálogo de packs.');for(const content of pack.contents)if(!await tx.objectStore('products').get(content.productId))throw new Error('Falta un componente documentado del pack.');if(stable(product.packContents??[])!==stable(pack.contents))await tx.objectStore('products').put({...product,packContents:pack.contents,revision:product.revision+1})}
  const prices = new Map(payload.eventPrices.map(p => [p.productId,p.prices]))
  for (const p of await tx.objectStore('products').getAll()) {
    const next = prices.get(p.id) ?? []
    if (stable(p.eventPrices ?? []) !== stable(next)) await tx.objectStore('products').put({ ...p, eventPrices: next, revision: p.revision+1 })
  }
  for (const id of prices.keys()) if (!await tx.objectStore('products').get(id)) throw new Error('Espera la recepción del catálogo antes de aplicar los precios especiales.')
  const revision = await tx.objectStore('metadata').get('event-price-revision')
  await tx.objectStore('metadata').put({ key:'event-price-revision',value:(revision?.value??0)+1 })
}
/** Explicit initial review: no sales or quantities are uploaded by this operation. */
export async function linkCommercial(token: string, remote: ConfigurationRecord | null, choice: 'local' | 'remote', uid: string, workspace: string, canWrite: boolean, name?: string) {
  return write(name, async tx => {
    const local = await configuration(tx), old = await tx.objectStore('commercialSync').get('commerce'), catalog = await tx.objectStore('catalogSync').get('catalog')
    if (stable({local,state:old}) !== token || old) throw new Error('La revisión cambió. Compara nuevamente.')
    if (!catalog || catalog.ownerUid!==uid || catalog.workspaceId!==workspace) throw new Error('Vincula primero el catálogo.')
    if (choice==='local' && !canWrite) throw new Error('Solo administración puede compartir la configuración.')
    if (choice==='local' && remote) throw new Error('Ya existe configuración compartida. Recíbela o revisa los registros locales antes de incorporarlos; no se reemplaza durante la vinculación.')
    if (choice==='remote' && !remote) throw new Error('Todavía no hay configuración compartida.')
    // Prevent an implicit merge/upload of older, unrelated local records.
    if (choice==='remote') {
      for (const [ours,theirs] of [[local.events,remote!.payload.events],[local.promotions,remote!.payload.promotions],[local.expenses,remote!.payload.expenses]] as const)
        if (ours.some(row=>!theirs.some(other=>other.id===row.id))) throw new Error('Hay registros locales que no existen en la nube. Respáldalos y revisa su incorporación antes de vincular; no se eliminaron datos.')
      await applyConfiguration(tx,remote!.payload)
    }
    const observed = await configuration(tx)
    const state: CommercialState = { key:'commerce',ownerUid:uid,workspaceId:workspace,deviceId:catalog.deviceId,canWrite,original:local,baseline:remote,observed,operations:[] }
    if(choice==='local')state.configurationPending={operationId:crypto.randomUUID(),actorUid:uid,deviceId:state.deviceId,expectedRevision:remote?.revision??0,payload:local}
    await tx.objectStore('commercialSync').put(state)
  })
}
export async function collectConfiguration(uid: string, canWrite: boolean, name?: string) {
  return write(name, async tx => {
    const state=await tx.objectStore('commercialSync').get('commerce')
    if(!state||state.ownerUid!==uid)return
    state.canWrite=canWrite
    const local=await configuration(tx)
    if(!state.configurationPending&&!state.configurationConflict&&stable(local)!==stable(state.observed)) {
      if(!canWrite){state.configurationError='Hay cambios locales de configuración que requieren administración.'}
      else state.configurationPending={operationId:crypto.randomUUID(),actorUid:uid,deviceId:state.deviceId,expectedRevision:state.baseline?.revision??0,payload:local}
    }
    await tx.objectStore('commercialSync').put(state)
    return state
  })
}
export async function receiveConfiguration(remote: ConfigurationRecord, uid: string, name?: string) {
  return write(name,async tx=>{
    const state=await tx.objectStore('commercialSync').get('commerce');if(!state||state.ownerUid!==uid)return
    if(remote.revision<=(state.baseline?.revision??0))return
    const local=await configuration(tx), own=state.configurationPending?.operationId===remote.operationId
    if(!own&&(state.configurationPending||stable(local)!==stable(state.observed))) {state.configurationConflict=true;state.configurationError='La configuración cambió en dos dispositivos. Revisa las versiones antes de continuar.'}
    else {
      if(!own)await applyConfiguration(tx,remote.payload)
      state.baseline=remote;state.observed=remote.payload;state.configurationPending=undefined;state.configurationError=undefined;state.configurationConflict=false;state.lastConfirmed=new Date().toISOString()
    }
    await tx.objectStore('commercialSync').put(state)
  })
}
export async function commercialError(uid: string, error: string, operationId?: string, name?: string) {
  await write(name,async tx=>{const state=await tx.objectStore('commercialSync').get('commerce');if(!state||state.ownerUid!==uid)return
    if(operationId){const op=state.operations.find(op=>(op.kind==='sale'?op.intent.sale.operationId:op.intent.operationId)===operationId);if(op){op.error=error;op.attempts++}}
    else {state.configurationError=error;if(error.startsWith('CONFLICT:'))state.configurationConflict=true}
    await tx.objectStore('commercialSync').put(state)
  })
}
export async function resolveConfiguration(remote: ConfigurationRecord, choice: 'local'|'remote', uid: string, token: string, name?: string) {
  await write(name,async tx=>{
    const state=await tx.objectStore('commercialSync').get('commerce'),local=await configuration(tx)
    if(!state||state.ownerUid!==uid||!state.canWrite||stable({local,state})!==token)throw new Error('La revisión cambió o requiere administración.')
    state.configurationResolutions??=[];state.configurationResolutions.push({local,remote,choice,at:new Date().toISOString()})
    state.baseline=remote;state.configurationConflict=false;state.configurationError=undefined
    if(choice==='remote'){await applyConfiguration(tx,remote.payload);state.observed=await configuration(tx);state.configurationPending=undefined}
    else {state.observed=local;state.configurationPending={operationId:crypto.randomUUID(),actorUid:uid,deviceId:state.deviceId,expectedRevision:remote.revision,payload:local}}
    await tx.objectStore('commercialSync').put(state)
  })
}
export async function receiveSales(rows: ReceivedSale[], uid: string, workspace: string, name?: string) {
  return write(name,async tx=>{
    const state=await tx.objectStore('commercialSync').get('commerce'), inventory=await tx.objectStore('inventorySync').get('inventory')
    if(!state||state.ownerUid!==uid||state.workspaceId!==workspace)return
    if(!inventory||inventory.ownerUid!==uid||inventory.workspaceId!==workspace)throw new Error('Incorpora el inventario antes de recibir ventas compartidas.')
    for(const row of rows){
      const {kind,receipt}=validateSaleReceipt(row.operation), sale=receipt.sale
      const opId=kind==='sale'?sale.operationId:receipt.sale.voidAudit!.operationId
      const own=state.operations.find(op=>(op.kind==='sale'?op.intent.sale.operationId:op.intent.operationId)===opId)
      const existing=await tx.objectStore('sales').get(sale.id)
      if(existing&&existing.operationId!==sale.operationId)throw new Error('El UUID de la venta coincide con otra operación local; requiere revisión.')
      if(existing&&!existing.sharedStatus)throw new Error('Una venta compartida coincide con una venta local no incorporada. Requiere revisión.')
      for(const item of sale.items)if(!await tx.objectStore('products').get(item.productId)||!inventory.products.includes(item.productId))throw new Error('Incorpora el inventario de todos los productos de esta venta para recibirla.')
      if(own){if(own.kind!==kind||stable(own.intent)!==stable(receipt.intent))throw new Error('La confirmación no corresponde a la operación local.');own.state='confirmed';own.error=undefined}
      // Old sale receipt cannot resurrect a voided sale when replaying the journal.
      if(!(existing?.status==='voided'&&kind==='sale'))await tx.objectStore('sales').put({...sale,sharedStatus:'confirmed',deviceId:sale.deviceId??existing?.deviceId??receipt.intent.deviceId})
      for(const payment of sale.payments){const previous=await tx.objectStore('payments').get(payment.id);if(previous&&previous.saleId!==sale.id)throw new Error('UUID de pago ocupado por otra venta.');await tx.objectStore('payments').put(payment)}
      for(const movement of receipt.movements){const previous=await tx.objectStore('movements').get(movement.id);if(previous&&previous.saleId!==sale.id)throw new Error('UUID de movimiento ocupado.');await tx.objectStore('movements').put(movement)}
      for(const[id,balance]of Object.entries(receipt.after))if(!inventory.baseline[id]||inventory.baseline[id].revision<balance.revision)inventory.baseline[id]=balance
      const counter=await tx.objectStore('metadata').get('sale-number');if((counter?.value??0)<sale.number)await tx.objectStore('metadata').put({key:'sale-number',value:sale.number})
      if(row.cursor.id&&(!state.cursor||row.cursor.seconds>state.cursor.seconds||row.cursor.seconds===state.cursor.seconds&&(row.cursor.nanoseconds>state.cursor.nanoseconds||row.cursor.nanoseconds===state.cursor.nanoseconds&&row.cursor.id>state.cursor.id)))state.cursor=row.cursor
      state.lastConfirmed=new Date().toISOString()
    }
    // Manual pending operations remain owned by D2. Sales wait until those are acknowledged.
    for(const id of inventory.products){
      const balance=inventory.baseline[id],product=await tx.objectStore('products').get(id);if(!balance||!product)continue
      if(inventory.operations.some(op=>op.intent.productId===id&&['pending','conflict'].includes(op.state)))continue
      let stock=balance.stock
      const pending=state.operations.filter(op=>op.state!=='confirmed')
      for(const op of pending)if(op.kind==='sale'){const item=op.intent.sale.items.find(i=>i.productId===id);if(item)stock=calculateSaleStock(stock,item.quantity).resultingStock}
      const updated={...product,stock,stockCountPending:balance.countPending,inventoryPending:pending.some(op=>op.kind==='sale'&&op.intent.sale.items.some(i=>i.productId===id)),averageCost:balance.costs.averageCost??undefined,lastKnownCost:balance.costs.lastKnownCost??undefined,estimatedUnitCost:balance.costs.estimatedUnitCost??undefined,averageCostIsProvisional:balance.costs.averageCostIsProvisional}
      if(stable(updated)!==stable(product))await tx.objectStore('products').put({...updated,revision:product.revision+1})
    }
    await tx.objectStore('inventorySync').put(inventory);await tx.objectStore('commercialSync').put(state)
  })
}
