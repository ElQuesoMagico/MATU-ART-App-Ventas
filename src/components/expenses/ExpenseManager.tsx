import { useState } from 'react'
import { useCatalog } from '../../hooks/useCatalog'
import { Modal } from '../Modal'
import { EmptyState, SearchField } from '../ui'
import { ExpenseForm } from './ExpenseForm'
import { ExpenseDetail } from './ExpenseDetail'
import type { Expense } from '../../types/expenses'
import { money, dateLabel } from '../../utils/format'
import '../../styles/expenses.css'

export function ExpenseManager({ initialEventId, onClose }: { initialEventId?: string; onClose: () => void }) {
  const catalog = useCatalog()
  const [scope, setScope] = useState(initialEventId ?? 'all'), [status, setStatus] = useState('active'), [query, setQuery] = useState('')
  const [form, setForm] = useState<{ expense?: Expense }>(), [detail, setDetail] = useState<Expense>(), [notice, setNotice] = useState('')
  const items = catalog.expenses.filter(item => (scope === 'all' || (scope === 'none' ? !item.eventId : item.eventId === scope)) && (status === 'all' || item.status === status) && item.concept.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))
  return <><Modal title="Gastos" onClose={onClose}>
    <div className="section-heading"><p className="muted">Los gastos globales no se reparten entre eventos.</p><button className="button primary" disabled={catalog.loading || !!catalog.error} onClick={() => setForm({})}>Nuevo gasto</button></div>
    {notice && <p role="status" className="save-notice">{notice}</p>}{catalog.error && <p role="alert" className="storage-error">{catalog.error}</p>}
    <div className="expense-filters"><SearchField value={query} onChange={setQuery} placeholder="Buscar gastos…" /><label>Evento<select value={scope} onChange={event => setScope(event.target.value)}><option value="all">Todos los gastos</option><option value="none">Globales · Sin evento</option>{catalog.realEvents.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label><label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="active">Activos</option><option value="voided">Anulados</option><option value="all">Todos</option></select></label></div>
    <p className="expense-visible-total">Gastos activos en esta vista: <strong>{money(items.filter(item => item.status === 'active').reduce((sum, item) => sum + BigInt(item.amount), 0n))}</strong></p>
    {!items.length ? <EmptyState title="Sin gastos" description="Registra un gasto o cambia los filtros." /> : <div className="expense-list">{items.map(item => <article key={item.id}><header><strong>{item.concept}</strong><strong>{money(item.amount)}</strong></header><p>{dateLabel(item.date)} · {catalog.expenseCategories.find(category => category.id === item.categoryId)?.name ?? 'Categoría no disponible'}</p><p>{item.eventId ? catalog.realEvents.find(event => event.id === item.eventId)?.name ?? 'Evento no disponible' : 'Global · Sin evento'}</p><footer><span className={`badge ${item.status === 'active' ? 'green' : 'neutral'}`}>{item.status === 'active' ? 'Activo' : 'Anulado'}</span><button className="text-button" onClick={() => setDetail(item)}>Ver detalle</button>{item.status === 'active' && <button className="button secondary" onClick={() => setForm({ expense: item })}>Editar</button>}</footer></article>)}</div>}
  </Modal>{form && <ExpenseForm expense={form.expense} eventId={scope === 'all' || scope === 'none' ? undefined : scope} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); setNotice('Gasto guardado.') }} />}{detail && <ExpenseDetail expense={detail} onClose={() => setDetail(undefined)} />}</>
}
