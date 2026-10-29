import { useState } from 'react'
import { useCatalog } from '../../hooks/useCatalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { entityAdministration } from '../../services/entityAdministration'
import { Modal } from '../Modal'
export function ReassignCategoryDialog({ sourceId, onClose, onSaved }: { sourceId: string; onClose: () => void; onSaved: (message: string) => void }) {
  const catalog = useCatalog(); const action = useStorageAction()
  const [target, setTarget] = useState('')
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof entityAdministration.previewCategory>>>()
  return <Modal title="Reasignar categoría" onClose={onClose} busy={action.saving}>
    <p>Origen: {catalog.categories.find(c => c.id === sourceId)?.name}. Se incluyen productos archivados. Las familias, ventas y promociones históricas se conservan.</p>
    <label className="classification-search">Nueva categoría<select value={target} onChange={event => { setTarget(event.target.value); setPlan(undefined) }}><option value="">Seleccionar</option>{catalog.categories.filter(c => c.isActive && c.id !== sourceId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {action.error && <p role="alert" className="storage-error">{action.error}</p>}
    {plan && <section><h3>{plan.products.length} productos afectados</h3><ul>{plan.products.map(p => <li key={p.id}>{p.name}{p.isArchived ? ' (archivado)' : ''}</li>)}</ul><p>La categoría de origen no se elimina. Sus referencias históricas seguirán bloqueando su eliminación cuando corresponda.</p></section>}
    <div className="form-actions"><button className="button secondary" data-close-modal disabled={action.saving}>Cancelar</button><button className="button secondary" disabled={!target || action.saving} onClick={() => { void action.run(() => entityAdministration.previewCategory(sourceId, target), setPlan) }}>Vista previa</button><button className="button primary" disabled={!plan?.products.length || action.saving} onClick={() => { if (plan) void action.run(() => entityAdministration.reassignCategory(sourceId, target, plan.token), count => { onSaved(`${count} productos reasignados.`); onClose() }) }}>Confirmar reasignación</button></div>
  </Modal>
}
