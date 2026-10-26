import { TicketFrame } from '../components/TicketFrame'
import { ReportButton } from '../components/data/ReportButton'
import { ExpenseManager } from '../components/expenses/ExpenseManager'
import { useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useStorageAction } from '../hooks/useStorageAction'
import { eventRepository } from '../services/eventRepository'
import { eventDateRange, eventStatusLabels } from '../services/eventRules'
import type { CatalogEvent } from '../types/events'
import { dateTimeLabel } from '../utils/format'
import { CircusIllustration } from '../components/CircusIllustration'
import { Ornament } from '../components/Ornament'
import { EmptyState, PageHeading, SearchField } from '../components/ui'
import { CatalogStatus } from '../components/CatalogStatus'
import { Modal } from '../components/Modal'
import { EventForm } from '../components/events/EventForm'
type EventAction = { type: 'activate' | 'deactivate' | 'finish'; event: CatalogEvent; previous?: CatalogEvent }
export function Events() {
  const catalog = useCatalog(), action = useStorageAction()
  const [expenseScope, setExpenseScope] = useState<string>()
  const [form, setForm] = useState<{ event?: CatalogEvent }>()
  const [detail, setDetail] = useState<CatalogEvent>()
  const [confirmation, setConfirmation] = useState<EventAction>()
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [notice, setNotice] = useState('')
  const active = catalog.realEvents.find(event => event.status === 'active')
  const events = catalog.realEvents.filter(event => (status === 'all' || event.status === status) && `${event.name} ${event.location ?? ''} ${event.description ?? ''}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'))).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id))
  function ask(type: EventAction['type'], event: CatalogEvent) { action.setError(''); setConfirmation({ type, event, previous: type === 'activate' ? active : undefined }) }
  function confirm() {
    if (!confirmation) return
    const { type, event, previous } = confirmation
    void action.run(() => type === 'activate' ? eventRepository.activate(event.id, event.updatedAt, previous ? { id: previous.id, updatedAt: previous.updatedAt } : undefined) : eventRepository.changeState(event.id, type === 'finish' ? 'finished' : 'upcoming', event.updatedAt), () => { setConfirmation(undefined); setNotice(type === 'finish' ? 'Evento finalizado.' : type === 'deactivate' ? 'Evento desactivado, sin finalizar.' : 'Evento activo actualizado.') })
  }
  const currentDetail = detail ? catalog.realEvents.find(event => event.id === detail.id) ?? detail : undefined
  return <><PageHeading title="Eventos" action={<div className="heading-actions"><button className="button secondary" disabled={catalog.loading || !!catalog.error} onClick={() => setExpenseScope('all')}>Gastos</button><button className="button primary" disabled={catalog.loading || !!catalog.error} onClick={() => setForm({})}>Nuevo evento</button></div>} /><CatalogStatus />
    {notice && <p className="save-notice" role="status">{notice}</p>}
    {!catalog.loading && !catalog.error && <>
      <section className="event-spotlight"><div><span className={`badge ${active ? 'green' : 'neutral'}`}>{active ? 'Evento activo' : 'Sin evento activo'}</span>{active ? <><h2>{active.name}</h2>{active.location && <p>{active.location}</p>}<p className="event-date">{eventDateRange(active)}</p><div className="event-actions"><button className="button secondary" onClick={() => setDetail(active)}>Ver detalles</button><button className="text-button" onClick={() => ask('finish', active)}>Finalizar evento</button></div></> : <><p>Crea o activa un evento. Puedes registrar ventas sin evento.</p><button className="button secondary" onClick={() => setForm({})}>Crear evento</button></>}</div><CircusIllustration /></section>
      <div className="sales-filters event-filters"><SearchField value={query} onChange={setQuery} placeholder="Buscar eventos…" /><label>Estado<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos</option><option value="upcoming">Próximos</option><option value="active">Activos</option><option value="finished">Finalizados</option></select></label><button className="text-button" onClick={() => { setQuery(''); setStatus('all') }}>Limpiar filtros</button></div>
      <div className="section-heading"><h2>Eventos</h2><span className="muted">{events.length} eventos</span></div>
      {events.length ? <div className="events-grid">{events.map(event => <article className={`panel event-card ticket-shaped event-${event.status}`} key={event.id}><TicketFrame axis="ends" /><div className="event-card-art"><CircusIllustration />{event.status === 'active' && <Ornament kind="rosette" className="event-rosette" size={40} />}</div><span className={`badge ${event.status === 'active' ? 'green' : event.status === 'upcoming' ? 'purple' : 'neutral'}`}>{eventStatusLabels[event.status]}</span><h3>{event.name}</h3>{event.location && <p className="muted">{event.location}</p>}<p className="event-date">{eventDateRange(event)}</p><div className="event-actions"><button className="text-button" onClick={() => setExpenseScope(event.id)} aria-label={`Gastos de ${event.name}`}>Gastos</button><button className="text-button" onClick={() => setDetail(event)} aria-label={`Ver detalles de ${event.name}`}>Ver detalles</button><button className="text-button" onClick={() => setForm({ event })} aria-label={`Editar ${event.name}`}>Editar</button>{event.status === 'upcoming' && <button className="button secondary" onClick={() => ask('activate', event)} aria-label={`Activar ${event.name}`}>Activar</button>}{event.status === 'active' && <button className="text-button" onClick={() => ask('deactivate', event)}>Desactivar</button>}{event.status !== 'finished' && <button className="text-button" onClick={() => ask('finish', event)} aria-label={`Finalizar ${event.name}`}>Finalizar</button>}</div></article>)}</div> : <EmptyState title={catalog.realEvents.length ? 'Sin coincidencias' : 'Sin eventos'} description={catalog.realEvents.length ? 'Prueba otra búsqueda o limpia los filtros.' : 'Crea tu primer evento para asociar tus próximas ventas.'} />}
    </>}
    {form && <EventForm event={form.event} onClose={() => setForm(undefined)} onSaved={setNotice} />}
    {currentDetail && <Modal title={currentDetail.name} onClose={() => setDetail(undefined)}><span className="badge neutral">{eventStatusLabels[currentDetail.status]}</span><p>{eventDateRange(currentDetail)}</p>{currentDetail.location && <p>{currentDetail.location}</p>}{currentDetail.description && <p className="event-description">{currentDetail.description}</p>}<p className="muted">Creado: {dateTimeLabel(currentDetail.createdAt)}</p><p className="muted">Actualizado: {dateTimeLabel(currentDetail.updatedAt)}</p>{currentDetail.activatedAt && <p className="muted">Última activación: {dateTimeLabel(currentDetail.activatedAt)}</p>}{currentDetail.finishedAt && <p className="muted">Finalizado: {dateTimeLabel(currentDetail.finishedAt)}</p>}<ReportButton key={currentDetail.id} eventId={currentDetail.id} /><p>{catalog.sales.filter(sale => sale.event?.id === currentDetail.id).length} ventas asociadas (incluye anuladas).</p><button className="button secondary" onClick={() => { setForm({ event: currentDetail }); setDetail(undefined) }}>Editar información</button></Modal>}
    {confirmation && <Modal title={confirmation.type === 'finish' ? 'Finalizar evento' : confirmation.type === 'deactivate' ? 'Desactivar evento' : 'Activar evento'} onClose={() => setConfirmation(undefined)} busy={action.saving}>{action.error && <p className="storage-error" role="alert">{action.error}</p>}
      {confirmation.type === 'finish' ? <p>¿Finalizar «{confirmation.event.name}»? No podrás reactivarlo. Su información y ventas se conservarán.</p> : confirmation.type === 'deactivate' ? <p>¿Desactivar «{confirmation.event.name}»? Quedará como próximo, sin finalizar. Las nuevas ventas se registrarán sin evento.</p> : <>{confirmation.previous && <p className="stock-warning">«{confirmation.previous.name}» está activo. Se desactivará y quedará como próximo, sin finalizar.</p>}<p>Las nuevas ventas se asociarán a «{confirmation.event.name}». Las anteriores conservarán su evento.</p></>}
      <div className="form-actions"><button className="button secondary" disabled={action.saving} onClick={() => setConfirmation(undefined)}>Cancelar</button><button className="button primary" disabled={action.saving} onClick={confirm}>{action.saving ? 'Guardando…' : confirmation.type === 'finish' ? 'Confirmar finalización' : confirmation.type === 'deactivate' ? 'Confirmar desactivación' : confirmation.previous ? 'Desactivar anterior y activar' : 'Confirmar activación'}</button></div>
    </Modal>}
    {expenseScope !== undefined && <ExpenseManager initialEventId={expenseScope} onClose={() => setExpenseScope(undefined)} />}
  </>
}
