import { useId, useState, type FormEvent } from 'react'
import { useCatalog } from '../../hooks/useCatalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import type { Expense, ExpenseFields } from '../../types/expenses'
import { expenseFieldErrors } from '../../services/expenseRules'
import { expenseRepository } from '../../services/expenseRepository'
import { santiagoDay } from '../../utils/format'
import { Modal } from '../Modal'

function CategoryForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [id] = useState(() => crypto.randomUUID()), [name, setName] = useState('')
  const action = useStorageAction()
  return <Modal title="Nueva categoría de gasto" onClose={onClose} protectChanges hasChanges={!!name} busy={action.saving}><form className="catalog-form" onSubmit={event => { event.preventDefault(); void action.run(() => expenseRepository.createCategory(id, name), category => onCreated(category.id)) }}>
    {action.error && <p role="alert" className="storage-error">{action.error}</p>}<label>Nombre<input required maxLength={120} value={name} disabled={action.saving} onChange={event => setName(event.target.value)} /></label><div className="form-actions"><button type="button" className="button secondary" data-close-modal disabled={action.saving}>Cancelar</button><button className="button primary" disabled={!name.trim() || action.saving}>Crear categoría</button></div></form></Modal>
}
export function ExpenseForm({ expense, eventId, onClose, onSaved }: { expense?: Expense; eventId?: string; onClose: () => void; onSaved: () => void }) {
  const catalog = useCatalog(), action = useStorageAction()
  const prefix = useId()
  const [id] = useState(() => expense?.id ?? crypto.randomUUID()), [operationId] = useState(() => crypto.randomUUID())
  const [initial] = useState(() => ({ concept: expense?.concept ?? '', amount: expense ? String(expense.amount) : '', categoryId: expense?.categoryId ?? '', date: expense?.date ?? santiagoDay(new Date().toISOString()), eventId: expense?.eventId ?? eventId ?? '', notes: expense?.notes ?? '' }))
  const [draft, setDraft] = useState(initial), [attempted, setAttempted] = useState(false), [creatingCategory, setCreatingCategory] = useState(false)
  const fields: ExpenseFields = { ...draft, amount: /^\d+$/.test(draft.amount) ? Number(draft.amount) : NaN, eventId: draft.eventId || undefined }
  const errors = expenseFieldErrors(fields)
  const update = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }))
  const error = (key: keyof ExpenseFields) => attempted && errors[key] ? <small id={`${prefix}-${key}`} className="field-error" role="alert">{errors[key]}</small> : null
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAttempted(true)
    if (Object.keys(errors).length) return
    void action.run(() => expenseRepository.save({ id, operationId, fields, expectedRevision: expense?.revision }), onSaved)
  }
  return <><Modal title={expense ? 'Editar gasto' : 'Nuevo gasto'} onClose={onClose} busy={action.saving} protectChanges hasChanges={JSON.stringify(initial) !== JSON.stringify(draft)}><form className="catalog-form expense-form" noValidate onSubmit={submit}>
    {action.error && <p role="alert" className="storage-error">{action.error}</p>}
    <fieldset className="form-fields" disabled={action.saving}>
      <label>Concepto<input aria-label="Concepto" aria-describedby={attempted && errors.concept ? `${prefix}-concept` : undefined} value={draft.concept} maxLength={120} aria-invalid={attempted && !!errors.concept} onChange={event => update('concept', event.target.value)} />{error('concept')}</label>
      <div className="form-grid"><label>Importe (CLP)<input aria-label="Importe (CLP)" aria-describedby={attempted && errors.amount ? `${prefix}-amount` : undefined} inputMode="numeric" value={draft.amount} aria-invalid={attempted && !!errors.amount} onChange={event => update('amount', event.target.value)} />{error('amount')}</label><label>Fecha<input type="date" value={draft.date} aria-invalid={attempted && !!errors.date} onInput={event => update('date', event.currentTarget.value)} onChange={event => update('date', event.target.value)} />{error('date')}</label></div>
      <div className="expense-category-field"><label>Categoría de gasto<select aria-label="Categoría de gasto" aria-describedby={attempted && errors.categoryId ? `${prefix}-categoryId` : undefined} value={draft.categoryId} aria-invalid={attempted && !!errors.categoryId} onChange={event => update('categoryId', event.target.value)}><option value="">Seleccionar categoría</option>{catalog.expenseCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{error('categoryId')}</label><button className="button secondary" type="button" aria-label="Crear categoría de gasto" onClick={() => setCreatingCategory(true)}>+</button></div>
      <label>Evento<select value={draft.eventId} onChange={event => update('eventId', event.target.value)}><option value="">Global · Sin evento</option>{catalog.realEvents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Notas (opcional)<textarea rows={2} maxLength={2000} value={draft.notes} onChange={event => update('notes', event.target.value)} />{error('notes')}</label>
    </fieldset><div className="form-actions"><button type="button" className="button secondary" data-close-modal disabled={action.saving}>Cancelar</button><button className="button primary" disabled={action.saving}>{action.saving ? 'Guardando…' : 'Guardar gasto'}</button></div>
  </form></Modal>{creatingCategory && <CategoryForm onClose={() => setCreatingCategory(false)} onCreated={id => { update('categoryId', id); setCreatingCategory(false) }} />}</>
}
