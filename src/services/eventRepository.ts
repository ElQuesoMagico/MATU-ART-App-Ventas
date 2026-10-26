import { openCatalogDatabase, type CatalogSchema } from './catalogDatabase.ts'
import type { IDBPTransaction } from 'idb'
import { CatalogError, validId } from './catalogValidation.ts'
import { validateEvent } from './eventRules.ts'
import type { CatalogEvent, EventFields } from '../types/events.ts'
type EventTransaction = IDBPTransaction<CatalogSchema, ['managedEvents', 'metadata'], 'readwrite'>
export class EventRepository {
  private readonly databaseName?: string
  constructor(databaseName?: string) { this.databaseName = databaseName }
  async snapshot() {
    const db = await openCatalogDatabase(this.databaseName)
    try { return (await db.getAll('managedEvents')).sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)) }
    finally { db.close() }
  }
  private async write<T>(operation: (tx: EventTransaction) => Promise<T>) {
    const db = await openCatalogDatabase(this.databaseName), tx = db.transaction(['managedEvents', 'metadata'] as const, 'readwrite')
    void tx.done.catch(() => {})
    try { const result = await operation(tx); await tx.done; return result }
    catch (error) { try { tx.abort() } catch { /* Ya completada. */ } await tx.done.catch(() => {}); throw error }
    finally { db.close() }
  }
  async save(id: string, fields: EventFields, expectedUpdatedAt?: string) {
    validId(id); validateEvent(fields)
    const clean: EventFields = { name: fields.name.trim(), description: fields.description?.trim() || undefined, location: fields.location?.trim() || undefined, startDate: fields.startDate, endDate: fields.endDate }
    return this.write(async tx => {
      const store = tx.objectStore('managedEvents'), previous = await store.get(id)
      // ID estable durante el formulario: reintento de creación no duplica el evento.
      if (previous && !expectedUpdatedAt && Object.keys(clean).every(key => previous[key as keyof EventFields] === clean[key as keyof EventFields])) return previous
      if (previous ? previous.updatedAt !== expectedUpdatedAt : !!expectedUpdatedAt) throw new CatalogError('El evento cambió en otra pestaña. Vuelve a abrirlo antes de guardar.')
      const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
      const saved: CatalogEvent = previous ? { ...previous, ...clean, updatedAt: now } : { ...clean, id, status: 'upcoming', createdAt: now, updatedAt: now }
      await store.put(saved); return saved
    })
  }
  async activate(id: string, expectedUpdatedAt: string, replace?: { id: string; updatedAt: string }) {
    validId(id)
    return this.write(async tx => {
      const store = tx.objectStore('managedEvents'), event = await store.get(id)
      if (!event) throw new CatalogError('El evento ya no está disponible.')
      if (event.status === 'finished') throw new CatalogError('Un evento finalizado no puede reactivarse.')
      if (event.status === 'active') return event
      if (event.updatedAt !== expectedUpdatedAt) throw new CatalogError('El evento cambió. Revisa su información antes de activarlo.')
      const active = await store.index('active-event').get('active')
      if (active && (!replace || replace.id !== active.id || replace.updatedAt !== active.updatedAt)) throw new CatalogError(`Ya está activo «${active.name}». Revisa y confirma el cambio de evento; no se finalizó ninguno.`)
      if (!active && replace) throw new CatalogError('El evento activo cambió en otra pestaña. Revisa antes de confirmar.')
      const now = new Date(Math.max(Date.now(), Date.parse(event.updatedAt) + 1, active ? Date.parse(active.updatedAt) + 1 : 0)).toISOString()
      // Desactivar anterior y activar nuevo en una transacción. Nunca finalizar aquí.
      if (active) await store.put({ ...active, status: 'upcoming', activeKey: undefined, updatedAt: now })
      const updated: CatalogEvent = { ...event, status: 'active', activeKey: 'active', activatedAt: now, updatedAt: now }
      await store.put(updated); await this.bumpPriceContext(tx); return updated
    })
  }
  async changeState(id: string, state: 'upcoming' | 'finished', expectedUpdatedAt: string) {
    validId(id)
    return this.write(async tx => {
      const store = tx.objectStore('managedEvents'), event = await store.get(id)
      if (!event) throw new CatalogError('El evento ya no está disponible.')
      if (event.status === 'finished') throw new CatalogError('El evento está finalizado. No se puede cambiar su estado.')
      if (event.updatedAt !== expectedUpdatedAt) throw new CatalogError('El evento cambió en otra pestaña. Revisa antes de continuar.')
      const now = new Date(Math.max(Date.now(), Date.parse(event.updatedAt) + 1)).toISOString()
      const updated: CatalogEvent = { ...event, status: state, activeKey: undefined, updatedAt: now, finishedAt: state === 'finished' ? now : undefined }
      await store.put(updated); if (event.status === 'active') await this.bumpPriceContext(tx); return updated
    })
  }
  private async bumpPriceContext(tx: EventTransaction) {
    const store = tx.objectStore('metadata'), previous = await store.get('event-price-revision')
    const next = (previous?.value ?? 0) + 1
    if (!Number.isSafeInteger(next) || next < 1) throw new CatalogError('No se pudo actualizar la revisión del evento.')
    await store.put({ key: 'event-price-revision', value: next })
  }
}
export const eventRepository = new EventRepository()
