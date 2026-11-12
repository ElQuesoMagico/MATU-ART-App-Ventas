import { collection, doc, documentId, getDocFromServer, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp, type Firestore } from 'firebase/firestore'
import { stable } from '../catalogModel.ts'
import { inventoryBalanceSchema, type InventoryBalance } from './inventoryProtocol.ts'
import { planSharedSale, planSharedVoid, sharedSaleIntentSchema, sharedVoidIntentSchema, type SharedSaleIntent, type SharedSaleReceipt, type SharedVoidIntent, type SharedVoidReceipt } from './saleProtocol.ts'
import type { InventoryCursor } from './inventoryState.ts'
export type CommercialSaleReceipt = { kind: 'sale'; receipt: SharedSaleReceipt } | { kind: 'void'; receipt: SharedVoidReceipt }
export interface ReceivedSale { operation: CommercialSaleReceipt; cursor: InventoryCursor }
export function validateSaleReceipt(value: CommercialSaleReceipt): CommercialSaleReceipt {
  const actual = value.kind === 'sale' ? planSharedSale(value.receipt.intent, value.receipt.before)
    : planSharedVoid(value.receipt.intent, { ...value.receipt.sale, status: 'completed', voidAudit: undefined, voidActorUid: undefined }, value.receipt.before)
  if (stable(actual) !== stable(value.receipt)) throw new Error('Recibo comercial inconsistente. No se modificaron los datos locales.')
  return value
}
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export function saleRemote(db: Firestore, workspace: string, uid: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(workspace) || !uid) throw new Error('Espacio o usuario inválido.')
  const root = `workspaces/${workspace}`
  const parse = (data: Record<string, unknown>, id: string): ReceivedSale => {
    const { confirmedAt, ...operation } = data
    if (!(confirmedAt instanceof Timestamp)) throw new Error('Falta confirmación comercial del servidor.')
    const validated = validateSaleReceipt(operation as CommercialSaleReceipt)
    const operationId = validated.kind === 'sale' ? validated.receipt.intent.sale.operationId : validated.receipt.intent.operationId
    if (operationId !== id) throw new Error('Identificador comercial inconsistente.')
    return { operation: validated, cursor: { seconds: confirmedAt.seconds, nanoseconds: confirmedAt.nanoseconds, id } }
  }
  async function commit(kind: 'sale' | 'void', raw: SharedSaleIntent | SharedVoidIntent) {
    const intent = kind === 'sale' ? sharedSaleIntentSchema.parse(raw) as SharedSaleIntent : sharedVoidIntentSchema.parse(raw)
    if (intent.actorUid !== uid) throw new Error('La operación pertenece a otra cuenta.')
    const saleIntent = kind === 'sale' ? intent as SharedSaleIntent : undefined, voidIntent = kind === 'void' ? intent as SharedVoidIntent : undefined
    const id = saleIntent ? saleIntent.sale.operationId : voidIntent!.operationId
    const saleId = saleIntent ? saleIntent.sale.id : voidIntent!.saleId
    const operationRef = doc(db, `${root}/saleOperations/${id}`), saleRef = doc(db, `${root}/sharedSales/${saleId}`)
    return runTransaction(db, async tx => {
      const [old, saved] = await Promise.all([tx.get(operationRef), tx.get(saleRef)])
      if (old.exists()) {
        const existing = parse(old.data(), id).operation
        if (existing.kind !== kind || stable(existing.receipt.intent) !== stable(intent)) throw new Error('Identificador comercial ya utilizado con otros datos.')
        return existing
      }
      if (saleIntent && saved.exists()) throw new Error('La venta ya existe con otra operación.')
      if (voidIntent && (!saved.exists() || saved.data()!.sale.status !== 'completed')) throw new Error('La venta ya fue anulada o no está compartida.')
      const original = saleIntent?.sale ?? saved.data()!.sale as SharedSaleReceipt['sale']
      const ids = kind === 'sale' || voidIntent?.returnStock ? original.items.map(i => i.productId) : []
      const balances: Record<string, InventoryBalance> = {}
      for (const productId of ids) {
        const snapshot = await tx.get(doc(db, `${root}/inventory/${productId}`))
        if (!snapshot.exists()) throw new Error('Falta inventario compartido para un producto de esta venta.')
        balances[productId] = inventoryBalanceSchema.parse(snapshot.data().balance)
      }
      const operation: CommercialSaleReceipt = saleIntent ? { kind: 'sale', receipt: planSharedSale(saleIntent, balances) }
        : { kind: 'void', receipt: planSharedVoid(voidIntent!, original, balances) }
      if (new TextEncoder().encode(JSON.stringify(operation)).length > 700_000) throw new Error('La venta supera el límite seguro de tamaño compartido.')
      for (const [productId, balance] of Object.entries(operation.receipt.after)) tx.set(doc(db, `${root}/inventory/${productId}`), { balance, confirmedAt: serverTimestamp() })
      // Do not JSON-serialize serverTimestamp sentinels.
      tx.set(saleRef, { ...clean({ sale: operation.receipt.sale, operationId: id, actorUid: uid, deviceId: intent.deviceId }), confirmedAt: serverTimestamp() })
      tx.set(operationRef, { ...clean(operation), confirmedAt: serverTimestamp() })
      return clean(operation)
    })
  }
  async function retryCommit(kind: 'sale' | 'void', intent: SharedSaleIntent | SharedVoidIntent) {
    for (let attempt = 0; ; attempt++) {
      try { return await commit(kind, intent) }
      catch (error) {
        // Rules can reject an optimistic read before the SDK reports contention.
        // Retry the identical intent, never a new sale or operation ID. Real denial remains an error.
        if (attempt >= 2 || !(error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied')) throw error
        await new Promise(resolve => setTimeout(resolve, 75 * (attempt + 1)))
      }
    }
  }
  return {
    commitSale: (intent: SharedSaleIntent) => retryCommit('sale', intent), commitVoid: (intent: SharedVoidIntent) => retryCommit('void', intent),
    async confirmed(id: string) { const row = await getDocFromServer(doc(db, `${root}/saleOperations/${id}`)); if (!row.exists()) throw new Error('Venta todavía no confirmada.'); const result = parse(row.data(), id); result.cursor.id = ''; return result },
    watchPage(cursor: InventoryCursor | undefined, next: (rows: ReceivedSale[]) => void, error: (error: Error) => void) {
      return onSnapshot(query(collection(db, `${root}/saleOperations`), orderBy('confirmedAt'), orderBy(documentId()), ...(cursor ? [startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id)] : []), limit(50)), { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites || snapshot.empty) return
        try { next(snapshot.docs.map(row => parse(row.data(), row.id))) } catch (cause) { error(cause instanceof Error ? cause : new Error('Recibo comercial inválido.')) }
      }, error)
    },
  }
}
