import { useEffect, useState } from 'react'
import { entityAdministration, entityLabels, type DeletionReview, type EntityKind } from '../../services/entityAdministration'
import { useStorageAction } from '../../hooks/useStorageAction'
import { Modal } from '../Modal'
export function DeleteEntityDialog({ kind, id, onClose, onSaved, onArchive }: { kind: EntityKind; id: string; onClose: () => void; onSaved: (message: string) => void; onArchive: () => Promise<unknown> }) {
  const action = useStorageAction()
  const [review, setReview] = useState<DeletionReview>()
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  useEffect(() => { let live = true; void entityAdministration.review(kind, id).then(value => { if (live) setReview(value) }).catch(() => { if (live) setError('No se pudieron comprobar las relaciones. No se eliminará el registro.') }); return () => { live = false } }, [kind, id])
  return <Modal title="Eliminar definitivamente" onClose={onClose} busy={action.saving}>
    {(error || action.error) && <p role="alert" className="storage-error">{error || action.error}</p>}
    {!review && !error && <p role="status">Comprobando relaciones…</p>}
    {review && <><h3>{entityLabels[kind]}: {review.name}</h3><p>La eliminación es permanente y no puede deshacerse. No borra otros registros.</p>
      {review.allowed ? <><p>No se detectaron dependencias ni antecedentes que exijan conservar este registro local.</p><label className="classification-search">Escribe «{review.name}» para confirmar<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label></> : <><p className="stock-warning">Eliminación bloqueada. Puedes archivar y conservar el historial.</p><ul>{review.blockers.map(message => <li key={message}>{message}</li>)}</ul></>}
      <div className="form-actions"><button className="button secondary" data-close-modal disabled={action.saving}>Cancelar</button><button className="button secondary" disabled={action.saving} onClick={() => { void action.run(onArchive, () => { onSaved('Registro archivado.'); onClose() }) }}>Archivar</button><button className="button primary" disabled={action.saving || !review.allowed || confirmation !== review.name} onClick={() => { void action.run(() => entityAdministration.remove(review, confirmation), () => { onSaved('Registro eliminado definitivamente.'); onClose() }) }}>Eliminar definitivamente</button></div></>}
  </Modal>
}
