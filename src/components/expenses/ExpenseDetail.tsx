import { useEffect, useState } from 'react'
import type { Expense, ExpenseChange } from '../../types/expenses'
import { useCatalog } from '../../hooks/useCatalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { expenseRepository } from '../../services/expenseRepository'
import { storageError } from '../../services/catalogValidation'
import { money, dateLabel, dateTimeLabel } from '../../utils/format'
import { Modal } from '../Modal'

function ExpenseValues({ value }: { value: Expense }) {
  const catalog = useCatalog()
  return <dl className="expense-values"><div><dt>Concepto</dt><dd>{value.concept}</dd></div><div><dt>Importe</dt><dd>{money(value.amount)}</dd></div><div><dt>Fecha</dt><dd>{dateLabel(value.date)}</dd></div><div><dt>Categoría</dt><dd>{catalog.expenseCategories.find(item => item.id === value.categoryId)?.name ?? value.categoryId}</dd></div><div><dt>Evento</dt><dd>{value.eventId ? catalog.realEvents.find(item => item.id === value.eventId)?.name ?? value.eventId : 'Global · Sin evento'}</dd></div>{value.notes && <div><dt>Notas</dt><dd>{value.notes}</dd></div>}<div><dt>Estado</dt><dd>{value.status === 'active' ? 'Activo' : 'Anulado'}</dd></div></dl>
}
export function ExpenseDetail({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const catalog = useCatalog(), action = useStorageAction()
  const current = catalog.expenses.find(item => item.id === expense.id) ?? expense
  const [history, setHistory] = useState<ExpenseChange[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [voiding, setVoiding] = useState(false), [reason, setReason] = useState(''), [operationId] = useState(() => crypto.randomUUID())
  useEffect(() => { let mounted = true; expenseRepository.history(current.id).then(value => { if (mounted) { setHistory(value); setError('') } }).catch(cause => { if (mounted) setError(storageError(cause)) }).finally(() => { if (mounted) setLoading(false) }); return () => { mounted = false } }, [current.id, current.revision])
  return <Modal title="Detalle del gasto" onClose={onClose} busy={action.saving} protectChanges hasChanges={voiding && !!reason}>
    {action.error && <p role="alert" className="storage-error">{action.error}</p>}
    <ExpenseValues value={current} />
    {current.status === 'active' && !voiding && <button className="button secondary" onClick={() => setVoiding(true)}>Anular gasto</button>}
    {current.status === 'active' && voiding && <form className="catalog-form" onSubmit={event => { event.preventDefault(); void action.run(() => expenseRepository.void({ id: current.id, operationId, expectedRevision: expense.revision, reason }), () => setVoiding(false)) }}><p>El gasto dejará de incluirse en los resultados. Su registro y cambios se conservarán.</p><label>Motivo de anulación<textarea required maxLength={500} disabled={action.saving} value={reason} onChange={event => setReason(event.target.value)} /></label><div className="form-actions"><button className="button secondary" type="button" disabled={action.saving} onClick={() => setVoiding(false)}>Cancelar anulación</button><button className="button primary" disabled={action.saving || !reason.trim()}>{action.saving ? 'Anulando…' : 'Confirmar anulación'}</button></div></form>}
    <h3 className="expense-audit-heading">Historial de cambios</h3>{error ? <p role="alert" className="storage-error">{error}</p> : loading ? <p>Cargando auditoría…</p> : <div className="movement-list">{history.map(change => <article key={change.id}><strong>{change.type === 'create' ? 'Creación' : change.type === 'edit' ? 'Edición' : 'Anulación'}</strong><p>{dateTimeLabel(change.createdAt)}</p>{change.reason && <p>Motivo: {change.reason}</p>}<details><summary>Ver valores registrados · revisión {change.after.revision}</summary>{change.before && <><h4>Antes</h4><ExpenseValues value={change.before} /></>}<h4>Después</h4><ExpenseValues value={change.after} /><p className="audit-id">Operación: {change.id}</p></details></article>)}</div>}<details><summary>Identificador del gasto</summary><p className="audit-id">{current.id}</p></details>
  </Modal>
}
