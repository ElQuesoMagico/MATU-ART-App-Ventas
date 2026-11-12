import type { IDBPTransaction } from 'idb'
import { openCatalogDatabase, type CatalogSchema } from '../../catalogDatabase.ts'
import { calculateSaleStock } from '../../saleRules.ts'
import { CatalogError } from '../../catalogValidation.ts'
import type { MovementInput, InventoryMovement } from '../../../types/catalog.ts'
import { stable } from '../catalogModel.ts'
import { planInventory, type InventoryBalance, type InventoryIntent, type InventoryReceipt } from './inventoryProtocol.ts'
import { inventoryStateSchema, inventoryReceiptSchema, type InventorySyncState, type ReceivedInventory } from './inventoryState.ts'

type Tx = IDBPTransaction<CatalogSchema, ['products','movements','inventorySync','catalogSync','commercialSync'], 'readwrite'>
async function write<T>(name: string | undefined, action: (tx: Tx) => Promise<T>) {
  const db = await openCatalogDatabase(name), tx = db.transaction(['products','movements','inventorySync','catalogSync','commercialSync'], 'readwrite')
  void tx.done.catch(() => {})
  try { const result = await action(tx); await tx.done; return result }
  catch (error) { try { tx.abort() } catch { /* completed */ } await tx.done.catch(() => {}); throw error }
  finally { db.close() }
}
export async function inventoryView(name?: string) {
  const db = await openCatalogDatabase(name)
  try { const tx = db.transaction(['products','inventorySync'], 'readonly'); const [products,state] = await Promise.all([tx.objectStore('products').getAll(),tx.objectStore('inventorySync').get('inventory')]); await tx.done; return { products, state, token: stable({ products, state }) } }
  finally { db.close() }
}
export async function setInventoryPermission(uid: string, canWrite: boolean, name?: string) {
  await write(name, async tx => { const state = await tx.objectStore('inventorySync').get('inventory'); if(state?.ownerUid===uid&&state.canWrite!==canWrite) await tx.objectStore('inventorySync').put({...state,canWrite}) })
}
function movement(receipt: InventoryReceipt, status: InventoryMovement['sharedStatus']): InventoryMovement {
  const { intent, before, after, quantityChange } = receipt
  return { id: intent.operationId, sharedOperationId: intent.operationId, sharedStatus: status, actorUid: intent.actorUid,
    productId: intent.productId, type: intent.type === 'initialize' ? 'initial' : intent.type,
    quantityChange, previousStock: before?.stock ?? 0, resultingStock: after.stock, requestedQuantity: intent.quantity,
    previousStockUnknown: !before || before.countPending, createdAt: intent.occurredAt, reason: intent.reason || undefined, unitCost: intent.unitCost ?? undefined,
    costBefore: before ? { averageCost: before.costs.averageCost ?? undefined, lastKnownCost: before.costs.lastKnownCost ?? undefined, averageCostIsProvisional: before.costs.averageCostIsProvisional } : undefined,
    costAfter: { averageCost: after.costs.averageCost ?? undefined, lastKnownCost: after.costs.lastKnownCost ?? undefined, averageCostIsProvisional: after.costs.averageCostIsProvisional },
  }
}
async function project(tx: Tx, state: InventorySyncState, id: string) {
  const product = await tx.objectStore('products').get(id)
  if (!product) throw new CatalogError('Falta el producto del inventario compartido.')
  let balance: InventoryBalance | null = state.baseline[id] ?? null
  for (const operation of state.operations.filter(op => op.intent.productId === id && op.state === 'pending')) {
    try { balance = planInventory(operation.intent, balance).after }
    catch { operation.state = 'conflict'; operation.error = 'El saldo cambió. Revisa esta operación antes de volver a registrarla.'
      const old = await tx.objectStore('movements').get(operation.intent.operationId)
      if (old) await tx.objectStore('movements').put({ ...old, sharedStatus: 'conflict' })
    }
  }
  const commerce=await tx.objectStore('commercialSync').get('commerce')
  const pendingSales=commerce?.operations.filter(op=>op.state!=='confirmed'&&op.kind==='sale'&&op.intent.sale.items.some(i=>i.productId===id))??[]
  if(balance)for(const op of pendingSales)if(op.kind==='sale'){const item=op.intent.sale.items.find(i=>i.productId===id)!;balance={...balance,stock:calculateSaleStock(balance.stock,item.quantity).resultingStock}}
  const pending = pendingSales.length>0 || state.operations.some(op => op.intent.productId === id && (op.state === 'pending' || op.state === 'conflict'))
  const patch = balance ? { stock: balance.stock, stockCountPending: balance.countPending,
    averageCost: balance.costs.averageCost ?? undefined, lastKnownCost: balance.costs.lastKnownCost ?? undefined,
    estimatedUnitCost: balance.costs.estimatedUnitCost ?? undefined, averageCostIsProvisional: balance.costs.averageCostIsProvisional } : {}
  const updated = { ...product, ...patch, inventoryShared: true, inventoryPending: pending }
  if (stable(updated) !== stable(product)) await tx.objectStore('products').put({ ...updated, revision: product.revision + 1, updatedAt: new Date().toISOString() })
}
export interface InventorySelection { productId: string; action: 'receive' | 'unknown' | 'count'; quantity?: number }
/** Explicit preview token prevents applying an opening balance to a changed local database. */
export async function linkInventory(selections: InventorySelection[], remote: Record<string, InventoryBalance>, token: string, workspaceId: string, uid: string, canWrite: boolean, name?: string) {
  if (!selections.length || new Set(selections.map(row => row.productId)).size !== selections.length) throw new CatalogError('Selecciona productos sin repetirlos.')
  return write(name, async tx => {
    const products = await tx.objectStore('products').getAll(), previous = await tx.objectStore('inventorySync').get('inventory')
    if (stable({ products, state: previous }) !== token) throw new CatalogError('Los datos cambiaron. Revisa la comparación otra vez.')
    const catalog = await tx.objectStore('catalogSync').get('catalog')
    if (!catalog || catalog.ownerUid !== uid || catalog.workspaceId !== workspaceId) throw new CatalogError('Vincula primero el catálogo con esta cuenta y espacio.')
    const state: InventorySyncState = previous ?? { key: 'inventory', workspaceId, ownerUid: uid, deviceId: catalog.deviceId, canWrite, products: [], baseline: {}, originals: {}, operations: [] }
    if (state.ownerUid !== uid || state.workspaceId !== workspaceId) throw new CatalogError('El inventario pertenece a otra cuenta o espacio.')
    for (const selection of selections) {
      const p = products.find(p => p.id === selection.productId)
      if (!p || p.isArchived || state.products.includes(p.id) || !catalog.baseline[`products/${p.id}`] || catalog.pending[`products/${p.id}`] || catalog.excluded.includes(`products/${p.id}`)) throw new CatalogError('El producto debe estar activo, compartido y sin cambios pendientes de catálogo.')
      if (remote[p.id] ? selection.action !== 'receive' : selection.action === 'receive') throw new CatalogError('El inventario remoto cambió. Revisa su estado.')
      state.products.push(p.id)
      state.originals[p.id] = { stock: p.stock, countPending: !!p.stockCountPending, averageCost: p.averageCost ?? null, lastKnownCost: p.lastKnownCost ?? null, estimatedUnitCost: p.estimatedUnitCost ?? null, provisional: p.averageCostIsProvisional }
      if (remote[p.id]) state.baseline[p.id] = remote[p.id]
      else {
        if (!canWrite) throw new CatalogError('Solo administración puede incorporar existencias.')
        const intent: InventoryIntent = { schemaVersion: 1, operationId: crypto.randomUUID(), productId: p.id, deviceId: state.deviceId, actorUid: uid, occurredAt: new Date().toISOString(), type: 'initialize', expectedRevision: 0, quantity: 0, unitCost: null, reason: 'Incorporación explícita del inventario' }
        const receipt = planInventory(intent, null)
        state.operations.push({ intent, state: 'pending', attempts: 0 })
        await tx.objectStore('movements').add(movement(receipt, 'pending'))
        if (selection.action === 'count') {
          const count: InventoryIntent = { ...intent, operationId: crypto.randomUUID(), type: 'count', quantity: selection.quantity!, expectedRevision: 1, reason: 'Conteo inicial confirmado al incorporar' }
          const counted = planInventory(count, receipt.after)
          state.operations.push({ intent: count, state: 'pending', attempts: 0 })
          await tx.objectStore('movements').add(movement(counted, 'pending'))
        }
      }
      await project(tx, state, p.id)
    }
    // Backfill newly incorporated products; deduplication is by operation UUID.
    delete state.cursor
    await tx.objectStore('inventorySync').put(inventoryStateSchema.parse(state))
  })
}
export async function enqueueInventory(input: MovementInput, uid: string, workspaceId: string, name?: string) {
  return write(name, async tx => {
    const state = await tx.objectStore('inventorySync').get('inventory'), p = await tx.objectStore('products').get(input.productId)
    if (!state || state.ownerUid !== uid || state.workspaceId !== workspaceId || !state.canWrite || !state.products.includes(input.productId)) throw new CatalogError('No tienes autorización local para este inventario. Revisa Mi cuenta.')
    const commerce=await tx.objectStore('commercialSync').get('commerce')
    if(commerce?.operations.some(op=>op.state!=='confirmed'&&(op.kind==='sale'?op.intent.sale.items.some(i=>i.productId===input.productId):true)))throw new CatalogError('Confirma las ventas pendientes antes de ajustar el inventario.')
    const old = state.operations.find(op => op.intent.operationId === input.id)
    if (old) {
      if (old.intent.productId !== input.productId || old.intent.quantity !== input.quantity || old.intent.type !== input.type || old.intent.unitCost !== (input.unitCost ?? null) || old.intent.reason !== (input.reason?.trim() ?? '')) throw new CatalogError('Identificador ya utilizado con otros datos.')
      return
    }
    if (!p || p.isArchived || p.revision !== input.expectedRevision) throw new CatalogError('El producto cambió. Vuelve a revisar el formulario.')
    if (state.operations.some(op => op.intent.productId === p.id && op.state === 'conflict')) throw new CatalogError('Revisa primero las operaciones pendientes de este producto en Mi cuenta.')
    let base: InventoryBalance | null = state.baseline[p.id] ?? null
    for (const op of state.operations.filter(op => op.intent.productId === p.id && op.state === 'pending')) base = planInventory(op.intent, base).after
    const intent: InventoryIntent = { schemaVersion: 1, operationId: input.id, productId: p.id, deviceId: state.deviceId, actorUid: uid, occurredAt: new Date().toISOString(), expectedRevision: base?.revision ?? 0, type: input.type, quantity: input.quantity, unitCost: input.unitCost ?? null, reason: input.reason?.trim() ?? '' }
    let receipt: InventoryReceipt
    try { receipt = planInventory(intent, base) } catch (cause) { throw new CatalogError(cause instanceof Error ? cause.message : 'Operación inválida.') }
    state.operations.push({ intent, state: 'pending', attempts: 0 })
    await tx.objectStore('movements').add(movement(receipt, 'pending'))
    await project(tx, state, p.id)
    await tx.objectStore('inventorySync').put(state)
  })
}
/** Receipt + confirmed baseline + durable ACK + projection are committed together. */
export async function receiveInventory(rows: ReceivedInventory[], uid: string, workspaceId: string, name?: string) {
  return write(name, async tx => {
    const state = await tx.objectStore('inventorySync').get('inventory')
    if (!state || state.ownerUid !== uid || state.workspaceId !== workspaceId) return
    for (const row of rows) {
      const r = inventoryReceiptSchema.parse(row.receipt), id = r.intent.productId
      const planned = planInventory(r.intent, r.before)
      if (stable(planned) !== stable(r)) throw new CatalogError('El movimiento recibido no coincide con sus importes y existencias. Requiere revisión.')
      if (state.products.includes(id)) {
        const old = await tx.objectStore('movements').get(r.intent.operationId)
        if (old && old.sharedOperationId !== r.intent.operationId) throw new CatalogError('El identificador remoto coincide con un movimiento local distinto.')
        const own = state.operations.find(op => op.intent.operationId === r.intent.operationId)
        if (own && stable(own.intent) !== stable(r.intent)) throw new CatalogError('El recibo pertenece a otra intención.')
        if (own) { own.state = 'confirmed'; own.confirmedAt = new Date(row.cursor.seconds * 1000 + Math.floor(row.cursor.nanoseconds / 1_000_000)).toISOString(); own.error = undefined }
        await tx.objectStore('movements').put(movement(r, 'confirmed'))
        if (!state.baseline[id] || state.baseline[id].revision < r.after.revision) state.baseline[id] = r.after
      }
      // Only feed chronologically ordered server pages here; acknowledgements do not advance cursor.
      if (row.cursor.id) state.cursor = row.cursor
      state.lastConfirmed = new Date().toISOString()
    }
    for (const id of state.products) await project(tx, state, id)
    await tx.objectStore('inventorySync').put(state)
  })
}
export async function markInventoryAttempt(id: string, uid: string, error?: string, conflict = false, name?: string, countAttempt = true) {
  await write(name, async tx => {
    const state = await tx.objectStore('inventorySync').get('inventory')
    if (!state || state.ownerUid !== uid) return
    const op = state.operations.find(op => op.intent.operationId === id)
    if (!op || op.state !== 'pending') return
    if(countAttempt) op.attempts++; op.error = error
    if (conflict) { op.state = 'conflict'; const m = await tx.objectStore('movements').get(id); if (m) await tx.objectStore('movements').put({ ...m, sharedStatus: 'conflict' }) }
    await project(tx, state, op.intent.productId)
    await tx.objectStore('inventorySync').put(state)
  })
}
/** Only after a server check establishes no receipt exists. Keeps original intent and movement. */
export async function cancelInventoryConflict(id: string, uid: string, name?: string) {
  await write(name, async tx => {
    const state = await tx.objectStore('inventorySync').get('inventory')
    if (!state || state.ownerUid !== uid) throw new CatalogError('Cuenta distinta.')
    const op = state.operations.find(op => op.intent.operationId === id)
    if (!op || op.state !== 'conflict') throw new CatalogError('Solo se puede descartar una operación en revisión.')
    for (const next of state.operations.filter(next => next.intent.productId === op.intent.productId && next.intent.expectedRevision >= op.intent.expectedRevision && ['pending','conflict'].includes(next.state))) {
      next.state = 'cancelled'; next.error = 'Descartada explícitamente para revisar contra el saldo confirmado.'
      const m = await tx.objectStore('movements').get(next.intent.operationId)
      if (m) await tx.objectStore('movements').put({ ...m, sharedStatus: 'cancelled' })
    }
    await project(tx, state, op.intent.productId)
    await tx.objectStore('inventorySync').put(state)
  })
}
