import { ReassignCategoryDialog } from './ReassignCategoryDialog'
import { reviewSharedDeletion, removeSharedEntity, type SharedDeletionReview } from '../../services/firebase/catalogDeletion'
import { useEffect, useState } from 'react'
import { entityAdministration, entityLabels, type EntityKind } from '../../services/entityAdministration'
import { useStorageAction } from '../../hooks/useStorageAction'
import { Modal } from '../Modal'
export function DeleteEntityDialog({ kind, id, onClose, onSaved, onArchive }: { kind: EntityKind; id: string; onClose: () => void; onSaved: (message: string) => void; onArchive: () => Promise<unknown> }) {
  const action = useStorageAction()
  const [review, setReview] = useState<SharedDeletionReview>()
  const [error, setError] = useState('')
  const [reassign,setReassign]=useState(false)
  const [detach,setDetach]=useState<Awaited<ReturnType<typeof entityAdministration.previewDetach>>>()
  const [confirmation, setConfirmation] = useState('')
  useEffect(() => { let live = true; void reviewSharedDeletion(kind, id).then(value => { if (live) setReview(value) }).catch(cause => { if (live) setError(cause instanceof Error?cause.message:'No se pudieron comprobar las relaciones.') }); return () => { live = false } }, [kind, id])
  if(reassign)return <ReassignCategoryDialog sourceId={id} onClose={()=>setReassign(false)} onSaved={message=>{onSaved(message);onClose()}} />
  return <Modal title="Eliminar definitivamente" onClose={onClose} busy={action.saving}>
    {(error || action.error) && <p role="alert" className="storage-error">{error || action.error}</p>}
    {!review && !error && <p role="status">Comprobando relaciones…</p>}
    {review && <><h3>{entityLabels[kind]}: {review.name}</h3><p>La eliminación es permanente y no puede deshacerse. No borra otros registros.</p>
      {review.allowed ? <><p>Desaparecerá del catálogo de tus dispositivos después de confirmarse. Las ventas y los movimientos históricos se conservan.</p><label className="classification-search">Escribe «{review.name}» para confirmar<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label></> : <><p className="stock-warning">Eliminación bloqueada. Puedes archivar y conservar el historial.</p><ul>{review.blockers.map(message => <li key={message}>{message}</li>)}</ul></>}
      {!review.allowed&&kind==='categories'&&<button className="button secondary" onClick={()=>setReassign(true)}>Reasignar productos</button>}
      {!review.allowed&&(kind==='families'||kind==='ips')&&<><button className="button secondary" disabled={action.saving} onClick={()=>void action.run(()=>entityAdministration.previewDetach(kind,id),setDetach)}>Revisar productos para desvincular</button>{detach&&<section><h3>{detach.products.length} productos afectados</h3><ul>{detach.products.map(p=><li key={p.id}>{p.name}</li>)}</ul><button className="button secondary" disabled={action.saving||!detach.products.length} onClick={()=>void action.run(()=>entityAdministration.detach(kind,id,detach.token),()=>{onSaved('Asociaciones actualizadas. Espera su sincronización antes de eliminar.');onClose()})}>Confirmar desvinculación</button></section>}</>}
      <div className="form-actions"><button className="button secondary" data-close-modal disabled={action.saving}>Cancelar</button><button className="button secondary" disabled={action.saving} onClick={() => { void action.run(onArchive, () => { onSaved('Registro archivado.'); onClose() }) }}>Archivar</button><button className="button primary" disabled={action.saving || !review.allowed || confirmation !== review.name} onClick={() => { void action.run(() => removeSharedEntity(review, confirmation), () => { onSaved('Registro eliminado definitivamente.'); onClose() }) }}>Eliminar definitivamente</button></div></>}
  </Modal>
}
