export type EventStatus = 'upcoming' | 'active' | 'finished'
export interface EventFields {
  name: string
  description?: string
  location?: string
  // Días de calendario, nunca instantes UTC.
  startDate: string
  endDate: string
}
export interface CatalogEvent extends EventFields {
  id: string
  status: EventStatus
  createdAt: string
  updatedAt: string
  activatedAt?: string
  finishedAt?: string
  activeKey?: 'active'
}
