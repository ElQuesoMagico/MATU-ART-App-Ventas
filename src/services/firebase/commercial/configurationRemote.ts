import { doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'
import { validateConfiguration } from './configuration.ts'
import { stable } from '../catalogModel.ts'
import type { ConfigurationIntent, ConfigurationRecord } from './commercialState.ts'
export function configurationRemote(db: Firestore, workspace: string, uid: string) {
  const reference = doc(db, `workspaces/${workspace}/commercialConfiguration/current`)
  const parse = (data: Record<string, unknown>): ConfigurationRecord => {
    if (!Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || typeof data.operationId !== 'string') throw new Error('Revisión comercial inválida.')
    return { revision: Number(data.revision), operationId: data.operationId, payload: validateConfiguration(data.payload) }
  }
  return {
    async read() { const snapshot = await getDocFromServer(reference); return snapshot.exists() ? parse(snapshot.data()) : null },
    watch(next: (record: ConfigurationRecord | null) => void, error: (error: Error) => void) {
      return onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
        try { next(snapshot.exists() ? parse(snapshot.data()) : null) } catch (cause) { error(cause instanceof Error ? cause : new Error('Configuración inválida.')) }
      }, error)
    },
    async commit(intent: ConfigurationIntent) {
      if (intent.actorUid !== uid) throw new Error('Cuenta distinta.')
      validateConfiguration(intent.payload)
      return runTransaction(db, async tx => {
        const audit = doc(db, `workspaces/${workspace}/configurationOperations/${intent.operationId}`)
        const [old, current] = await Promise.all([tx.get(audit), tx.get(reference)])
        if (old.exists()) { if (stable(old.data().intent) !== stable(intent)) throw new Error('Operación comercial reutilizada.'); return parse(old.data().record) }
        const previous = current.exists() ? parse(current.data()) : null
        if ((previous?.revision ?? 0) !== intent.expectedRevision) throw new Error('CONFLICT: configuración modificada en otro dispositivo. Revisa ambas versiones.')
        const record = { revision: intent.expectedRevision + 1, operationId: intent.operationId, payload: intent.payload }
        const clean = JSON.parse(JSON.stringify(record)) as ConfigurationRecord
        tx.set(reference, { ...clean, actorUid: uid, confirmedAt: serverTimestamp() })
        tx.set(audit, { intent: JSON.parse(JSON.stringify(intent)), record: clean, confirmedAt: serverTimestamp() })
        return clean
      })
    },
  }
}
