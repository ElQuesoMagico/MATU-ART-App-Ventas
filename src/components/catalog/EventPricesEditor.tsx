import type { CatalogEvent } from '../../types/events'
import { eventStatusLabels } from '../../services/eventRules'
export interface EventPriceDraft { key: string; eventId: string; price: string }
export function EventPricesEditor({ events, rows, onChange, generalPrice }: { events: CatalogEvent[]; rows: EventPriceDraft[]; onChange: (rows: EventPriceDraft[]) => void; generalPrice: string }) {
  const available = events.filter(event => !rows.some(row => row.eventId === event.id))
  return <details className="event-prices-editor"><summary>Precios por evento{rows.length ? ` (${rows.length})` : ''}</summary>
    {!events.length && <p className="muted">Crea un evento en Eventos para configurar un precio especial.</p>}
    {rows.map((row, index) => <div className="event-price-row" key={row.key}>
      <label>Evento {index + 1}<select value={row.eventId} onChange={e => onChange(rows.map(item => item.key === row.key ? { ...item, eventId: e.target.value } : item))}>{!events.some(event => event.id === row.eventId) && <option value={row.eventId}>Evento no disponible</option>}{events.filter(event => event.id === row.eventId || !rows.some(item => item.eventId === event.id)).map(event => <option key={event.id} value={event.id}>{event.name} · {eventStatusLabels[event.status]}</option>)}</select></label>
      <label>Precio especial {index + 1} (CLP)<input type="text" inputMode="numeric" value={row.price} onChange={e => onChange(rows.map(item => item.key === row.key ? { ...item, price: e.target.value } : item))} /></label>
      <button className="text-button" type="button" aria-label={`Eliminar precio de ${events.find(event => event.id === row.eventId)?.name ?? 'evento'}`} onClick={() => onChange(rows.filter(item => item.key !== row.key))}>Eliminar excepción</button>
    </div>)}
    <button className="button secondary" type="button" disabled={!available.length} onClick={() => { if (available[0]) onChange([...rows, { key: crypto.randomUUID(), eventId: available[0].id, price: generalPrice || '0' }]) }}>Agregar precio por evento</button>
  </details>
}
