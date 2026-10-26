import { useState, type FormEvent } from 'react'
import type { ClassificationKind, CatalogClassification } from '../../types/catalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { classificationRepository } from '../../services/classificationRepository'
export function QuickClassification({ kind, onCancel, onCreated, onBusy }: { kind: ClassificationKind; onCancel: () => void; onCreated: (item: CatalogClassification) => void; onBusy: (busy: boolean) => void }) {
  const action = useStorageAction()
  const [id] = useState(() => crypto.randomUUID())
  const [name, setName] = useState(''); const [description, setDescription] = useState('')
  const label = kind === 'categories' ? 'categoría' : kind === 'families' ? 'familia' : 'IP'
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); onBusy(true)
    void action.run(() => classificationRepository.save(kind, { id, name, description, order: 0, isActive: true }), onCreated).finally(() => onBusy(false))
  }
  return <form className="catalog-form" onSubmit={submit}><h3>Nueva {label}</h3>{action.error && <p className="storage-error" role="alert">{action.error}</p>}<fieldset disabled={action.saving} className="form-fields"><label>Nombre de {label}<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Descripción (opcional)<textarea rows={2} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label></fieldset><div className="form-actions"><button className="button secondary" type="button" disabled={action.saving} data-close-modal onClick={onCancel}>Volver al producto</button><button className="button primary" disabled={action.saving}>Crear y seleccionar</button></div></form>
}
