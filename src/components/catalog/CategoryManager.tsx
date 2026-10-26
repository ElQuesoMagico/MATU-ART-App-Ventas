import { useState, type FormEvent } from 'react'
import type { CatalogCategory } from '../../types/catalog'
import { useCatalog } from '../../hooks/useCatalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { catalogRepository } from '../../services/catalogRepository'
import { Modal } from '../Modal'
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { categories } = useCatalog()
  const action = useStorageAction()
  const [id, setId] = useState<string>(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [order, setOrder] = useState('0')
  const [editing, setEditing] = useState<CatalogCategory>()
  const [notice, setNotice] = useState('')
  function reset() { setId(crypto.randomUUID()); setName(''); setOrder('0'); setEditing(undefined) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void action.run(() => catalogRepository.saveCategory({ id, name, order: Number(order), isActive: editing?.isActive ?? true }), () => { setNotice(editing ? 'Categoría actualizada.' : 'Categoría creada.'); reset() })
  }
  return <Modal title="Categorías" onClose={onClose} busy={action.saving} protectChanges>
    <form className="catalog-form" onSubmit={submit}>{action.error && <p className="storage-error" role="alert">{action.error}</p>}{notice && <p className="save-notice" role="status">{notice}</p>}
      <fieldset className="form-fields" disabled={action.saving}><div className="form-grid"><label>Nombre de categoría<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Orden<input type="number" required min="0" max="1000000000" step="1" value={order} onChange={event => setOrder(event.target.value)} /></label></div></fieldset>
      <div className="form-actions">{editing && <button className="button secondary" type="button" disabled={action.saving} onClick={reset}>Cancelar edición</button>}<button className="button primary" disabled={action.saving}>{action.saving ? 'Guardando…' : editing ? 'Guardar categoría' : 'Crear categoría'}</button></div>
    </form>
    <p className="muted">Archivar conserva las asociaciones y el historial.</p><div className="category-list">{categories.map(category => <article key={category.id}><div><strong>{category.name}</strong><small>{category.isActive ? 'Activa' : 'Archivada'} · Orden {category.order}</small></div><button className="text-button" disabled={action.saving} onClick={() => { setEditing(category); setId(category.id); setName(category.name); setOrder(String(category.order)); action.setError(''); setNotice('') }}>Editar</button><button className="text-button" disabled={action.saving} onClick={() => { void action.run(() => catalogRepository.saveCategory({ ...category, isActive: !category.isActive }), () => { setNotice(category.isActive ? 'Categoría archivada.' : 'Categoría restaurada.'); reset() }) }}>{category.isActive ? 'Archivar' : 'Restaurar'}</button></article>)}</div>
  </Modal>
}
