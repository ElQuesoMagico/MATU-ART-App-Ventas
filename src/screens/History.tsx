import { useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { PageHeading } from '../components/ui'
import { CatalogStatus } from '../components/CatalogStatus'
import { StoredSaleList } from '../components/StoredSaleList'
import { SaleDetail } from '../components/SaleDetail'
import type { StoredSale } from '../types/sales'
import { santiagoDay } from '../utils/format'
import { historyEventOptions, saleMatchesEvent } from '../services/eventRules'
export function History() {
  const catalog = useCatalog()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [eventId, setEventId] = useState('all')
  const [status, setStatus] = useState('all')
  const [detail, setDetail] = useState<StoredSale>()
  const events = historyEventOptions(catalog.realEvents, catalog.sales)
  const sales = catalog.sales.filter(sale => { const day = santiagoDay(sale.soldAt); return (!from || day >= from) && (!to || day <= to) && (status === 'all' || sale.status === status) && saleMatchesEvent(sale, eventId) })
  return <><PageHeading title="Historial" /><CatalogStatus />
    <div className="sales-filters"><label>Desde<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Hasta<input type="date" min={from || undefined} value={to} onChange={event => setTo(event.target.value)} /></label><label>Evento<select value={eventId} onChange={event => setEventId(event.target.value)}><option value="all">Todos los eventos</option><option value="none">Sin evento</option>{events.map(event => <option key={event.id} value={event.id}>{event.name}{event.historical ? ' (histórico)' : ''}</option>)}</select></label><label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos</option><option value="completed">Registradas</option><option value="voided">Anuladas</option></select></label><button className="text-button" onClick={() => { setFrom(''); setTo(''); setStatus('all'); setEventId('all') }}>Limpiar filtros</button></div>
    {from && to && to < from && <p className="stock-warning">La fecha final debe ser igual o posterior a la inicial.</p>}
    {!catalog.loading && !catalog.error && <section className="panel editorial-panel"><p className="muted">{sales.length} ventas</p><StoredSaleList sales={sales} onOpen={setDetail} /></section>}
    {detail && <SaleDetail sale={detail} onClose={() => setDetail(undefined)} />}
  </>
}

