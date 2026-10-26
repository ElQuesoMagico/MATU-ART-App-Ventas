import { CatalogError, validName } from './catalogValidation.ts'
import type { CatalogEvent, EventFields } from '../types/events.ts'
import type { StoredSale } from '../types/sales.ts'
export const eventStatusLabels = { upcoming: 'Próximo', active: 'Activo', finished: 'Finalizado' } as const
export function validateEvent(fields: EventFields) {
  validName(fields.name)
  if ((fields.description?.length ?? 0) > 2000) throw new CatalogError('La descripción admite hasta 2.000 caracteres.')
  if ((fields.location?.length ?? 0) > 300) throw new CatalogError('La ubicación admite hasta 300 caracteres.')
  for (const date of [fields.startDate, fields.endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new CatalogError('Ingresa fechas válidas de inicio y término.')
  }
  if (fields.endDate < fields.startDate) throw new CatalogError('La fecha de término no puede ser anterior al inicio.')
}
export const eventDateLabel = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  // Construir en calendario local al mediodía evita el desplazamiento de día UTC.
  const local = new Date(0)
  local.setFullYear(year, month - 1, date)
  local.setHours(12, 0, 0, 0)
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }).format(local)
}
export const eventDateRange = (event: Pick<CatalogEvent, 'startDate' | 'endDate'>) => event.startDate === event.endDate ? eventDateLabel(event.startDate) : `${eventDateLabel(event.startDate)} — ${eventDateLabel(event.endDate)}`
export const saleMatchesEvent = (sale: StoredSale, eventId: string) => eventId === 'all' || (eventId === 'none' ? !sale.event : sale.event?.id === eventId)
export function historyEventOptions(events: CatalogEvent[], sales: StoredSale[]) {
  const options = new Map(events.map(event => [event.id, { id: event.id, name: event.name, historical: false }]))
  for (const sale of sales) if (sale.event && !options.has(sale.event.id)) options.set(sale.event.id, { ...sale.event, historical: true })
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id))
}
