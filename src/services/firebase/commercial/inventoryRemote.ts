import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp, type Firestore } from 'firebase/firestore'
import { stable } from '../catalogModel.ts'
import { inventoryBalanceSchema, inventoryIntentSchema, planInventory, type InventoryBalance, type InventoryIntent, type InventoryReceipt } from './inventoryProtocol.ts'
import { inventoryReceiptSchema, type InventoryCursor, type ReceivedInventory } from './inventoryState.ts'

/** Candidate D2 transport. Not imported by application runtime until commercial onboarding is ready. */
export function inventoryRemote(db: Firestore, workspaceId: string, uid: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId) || !uid) throw new Error('Espacio o usuario inválido.')
  const root = `workspaces/${workspaceId}`
  return {
    async confirmed(id: string): Promise<ReceivedInventory> {
      const row = await getDocFromServer(doc(db, `${root}/inventoryOperations/${id}`))
      if (!row.exists()) throw new Error('El servidor todavía no confirmó la operación.')
      const { confirmedAt, ...payload } = row.data()
      if (!(confirmedAt instanceof Timestamp)) throw new Error('Falta fecha confirmada del servidor.')
      const receipt = inventoryReceiptSchema.parse(payload)
      if(receipt.intent.operationId!==id) throw new Error('Identificador de recibo inválido.')
      return { receipt, cursor: { seconds: confirmedAt.seconds, nanoseconds: confirmedAt.nanoseconds, id: '' } }
    },
    async read() {
      const snapshot = await getDocsFromServer(query(collection(db, `${root}/inventory`), limit(2001)))
      if (snapshot.size > 2000) throw new Error('El inventario supera el límite de incorporación.')
      return Object.fromEntries(snapshot.docs.map(row => { const balance = inventoryBalanceSchema.parse(row.data().balance); if (balance.productId !== row.id) throw new Error('Identidad inválida.'); return [row.id, balance] }))
    },
    async receipt(id: string): Promise<InventoryReceipt | undefined> {
      const row = await getDocFromServer(doc(db, `${root}/inventoryOperations/${id}`))
      if (!row.exists()) return undefined
      const { confirmedAt: _time, ...receipt } = row.data()
      const parsed = inventoryReceiptSchema.parse(receipt)
      if(parsed.intent.operationId!==id) throw new Error('Identificador de recibo inválido.')
      return parsed
    },
    watchPage(cursor: InventoryCursor | undefined, update: (rows: ReceivedInventory[]) => void, error: (error: Error) => void) {
      const constraints = [orderBy('confirmedAt'), orderBy(documentId()), ...(cursor ? [startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id)] : []), limit(100)]
      return onSnapshot(query(collection(db, `${root}/inventoryOperations`), ...constraints), { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites || snapshot.empty) return
        try { update(snapshot.docs.map(row => {
          const { confirmedAt, ...payload } = row.data()
          if (!(confirmedAt instanceof Timestamp)) throw new Error('Falta confirmación del servidor.')
          const receipt = inventoryReceiptSchema.parse(payload)
          if (row.id !== receipt.intent.operationId) throw new Error('Identificador de recibo inválido.')
          return { receipt, cursor: { seconds: confirmedAt.seconds, nanoseconds: confirmedAt.nanoseconds, id: row.id } }
        })) } catch (cause) { error(cause instanceof Error ? cause : new Error('Movimiento remoto inválido.')) }
      }, error)
    },
    async commit(raw: InventoryIntent): Promise<InventoryReceipt> {
      const intent = inventoryIntentSchema.parse(raw)
      if (intent.actorUid !== uid) throw new Error('La operación pertenece a otra cuenta.')
      const operation = doc(db, `${root}/inventoryOperations/${intent.operationId}`)
      const balance = doc(db, `${root}/inventory/${intent.productId}`)
      return runTransaction(db, async tx => {
        const oldOperation = await tx.get(operation)
        if (oldOperation.exists()) {
          const saved = oldOperation.data()
          if (stable(saved.intent) !== stable(intent)) throw new Error('Identificador de operación ya utilizado con otros datos.')
          const result = planInventory(intent, saved.before)
          if (stable(saved.after) !== stable(result.after) || saved.quantityChange !== result.quantityChange) throw new Error('El recibo remoto no es consistente.')
          return result
        }
        const [previous, product] = await Promise.all([tx.get(balance), tx.get(doc(db, `${root}/products/${intent.productId}`))])
        if (!product.exists() || product.data().payload.isArchived) throw new Error('El producto no está disponible para modificar existencias.')
        const receipt = planInventory(intent, previous.exists() ? inventoryBalanceSchema.parse(previous.data().balance) : null)
        tx.set(balance, { balance: receipt.after, confirmedAt: serverTimestamp() })
        // The immutable receipt embeds the complete movement: no separately writable duplicate ledger.
        tx.set(operation, { ...receipt, confirmedAt: serverTimestamp() })
        return receipt
      })
    },
    watch(update: (balances: InventoryBalance[]) => void, error: (error: Error) => void) {
      let previous = ''
      return onSnapshot(query(collection(db, `${root}/inventory`), limit(2001)), { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
        try {
          if (snapshot.size > 2000) throw new Error('El inventario requiere paginación antes de continuar.')
          const balances = snapshot.docs.map(row => {
            const balance = inventoryBalanceSchema.parse(row.data().balance)
            if (row.id !== balance.productId) throw new Error('Identidad de inventario inválida.')
            return balance
          })
          const signature = stable(balances)
          if (signature !== previous) { previous = signature; update(balances) }
        } catch (cause) { error(cause instanceof Error ? cause : new Error('Inventario inválido.')) }
      }, error)
    },
  }
}
