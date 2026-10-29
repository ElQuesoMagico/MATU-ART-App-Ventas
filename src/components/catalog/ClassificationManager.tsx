import { DeleteEntityDialog } from './DeleteEntityDialog'
import { ReassignCategoryDialog } from './ReassignCategoryDialog'
import { useState, type FormEvent } from 'react'
import type { CatalogClassification, ClassificationKind } from '../../types/catalog'
import { useCatalog } from '../../hooks/useCatalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { classificationRepository } from '../../services/classificationRepository'
import { productFamilyIds } from '../../services/catalogClassification'
import { Modal } from '../Modal'
export function ClassificationManager({ onClose, onPromotions, onProducts }: { onClose: () => void; onPromotions: () => void; onProducts?: () => void }) {
  const [formOpen,setFormOpen] = useState(false)
  const [deleting,setDeleting] = useState<CatalogClassification>()
  const [reassign,setReassign] = useState<string>()
  const catalog = useCatalog(); const action = useStorageAction()
  const [kind, setKind] = useState<ClassificationKind>('categories')
  const [id, setId] = useState<string>(() => crypto.randomUUID())
  const [editing, setEditing] = useState<CatalogClassification>()
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [order, setOrder] = useState('0')
  const [query, setQuery] = useState(''); const [notice, setNotice] = useState('')
  const items = catalog[kind].filter(item => `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))
  const label = kind === 'categories' ? 'categoría' : kind === 'families' ? 'familia' : 'IP'
  function reset() { setId(crypto.randomUUID()); setEditing(undefined); setName(''); setDescription(''); setOrder('0'); setFormOpen(false) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    void action.run(() => classificationRepository.save(kind, { id, name, description, order: Number(order), isActive: editing?.isActive ?? true, expectedUpdatedAt: editing?.updatedAt }), () => { setNotice('Clasificación guardada.'); reset() })
  }
  return <Modal title="Organizar catálogo" onClose={onClose} busy={action.saving}>
    <div className="category-filters">{(['categories', 'families', 'ips'] as const).map(value => <button className={`filter-chip ${kind === value ? 'selected' : ''}`} type="button" disabled={action.saving || !!name.trim() || !!description.trim() || order !== '0' || !!editing} aria-pressed={kind === value} key={value} onClick={() => { setKind(value); reset(); setQuery(''); setNotice(''); action.setError('') }}>{value === 'categories' ? 'Categorías' : value === 'families' ? 'Familias' : 'IPs'}</button>)}</div>
    <button className="button secondary" type="button" disabled={action.saving || !!name.trim() || !!description.trim() || !!editing || order !== '0'} onClick={onPromotions}>Promociones</button>
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}{notice && <p className="save-notice" role="status">{notice}</p>}
    <p className="muted">{catalog[kind].filter(item => item.isActive).length} activas · {catalog[kind].filter(item => !item.isActive).length} archivadas</p>
    <div className="form-actions"><button className="button primary" onClick={() => { reset(); setFormOpen(true) }}>Crear {label}</button>{onProducts && <button className="button secondary" onClick={onProducts}>Administrar productos</button>}</div>
    {formOpen && <Modal title={editing ? `Editar ${label}` : `Crear ${label}`} onClose={reset} busy={action.saving} protectChanges>
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}
    <form className="catalog-form" onSubmit={submit}><fieldset disabled={action.saving} className="form-fields">
      <div className="form-grid"><label>Nombre de {label}<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Orden<input type="number" min="0" step="1" max="1000000000" required value={order} onChange={event => setOrder(event.target.value)} /></label></div>
      <label>Descripción (opcional)<textarea maxLength={2000} rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
    </fieldset><div className="form-actions"><button className="button secondary" type="button" disabled={action.saving} onClick={() => { reset(); action.setError(''); setNotice('') }}>Cancelar edición</button><button className="button primary" disabled={action.saving}>{editing ? 'Guardar cambios' : `Crear ${label}`}</button></div></form></Modal>}
    <label className="classification-search">Buscar {kind === 'categories' ? 'categorías' : kind === 'families' ? 'familias' : 'IPs'}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="category-list">{items.map(item => { const count = catalog.products.filter(product => (kind === 'categories' ? product.categoryId === item.id : (kind === 'families' ? productFamilyIds(product) : product.ipIds ?? []).includes(item.id))).length; return <article key={item.id}><div><strong>{item.name}</strong>{catalog[kind].filter(other => other.normalizedName === item.normalizedName).length > 1 && <small className="negative-stock">Nombre duplicado heredado. Puedes renombrarlo.</small>}<small>{item.isActive ? 'Activa' : 'Archivada'} · Orden {item.order} · {count} productos</small>{item.description && <small>{item.description}</small>}</div><button className="text-button" disabled={action.saving} onClick={() => { setFormOpen(true); setEditing(item); setId(item.id); setName(item.name); setDescription(item.description ?? ''); setOrder(String(item.order)); action.setError('') }}>Editar</button><button className="text-button" disabled={action.saving} onClick={() => { void action.run(() => classificationRepository.save(kind, { ...item, isActive: !item.isActive, expectedUpdatedAt: item.updatedAt }), () => { setNotice(item.isActive ? 'Clasificación archivada.' : 'Clasificación reactivada.'); reset() }) }}>{item.isActive ? 'Archivar' : 'Reactivar'}</button>{kind === 'categories' && count > 0 && <button className="text-button" onClick={() => setReassign(item.id)}>Reasignar productos</button>}<button className="text-button" onClick={() => setDeleting(item)}>Eliminar</button></article> })}{!items.length && <p className="muted">No hay {kind === 'categories' ? 'categorías' : kind === 'families' ? 'familias' : 'IPs'} para esta búsqueda.</p>}</div>
    {deleting && <DeleteEntityDialog kind={kind} id={deleting.id} onClose={() => setDeleting(undefined)} onSaved={setNotice} onArchive={() => classificationRepository.save(kind,{...deleting,isActive:false,expectedUpdatedAt:deleting.updatedAt})} />}
    {reassign && <ReassignCategoryDialog sourceId={reassign} onClose={() => setReassign(undefined)} onSaved={setNotice} />}
  </Modal>
}
