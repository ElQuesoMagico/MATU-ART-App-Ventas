import { useState, type FormEvent } from 'react'
import type { CatalogEvent } from '../../types/events'
import { eventRepository } from '../../services/eventRepository'
import { useStorageAction } from '../../hooks/useStorageAction'
import { Modal } from '../Modal'
export function EventForm({ event, onClose, onSaved }: { event?: CatalogEvent; onClose: () => void; onSaved: (message: string) => void }) {
  const [id] = useState(() => event?.id ?? crypto.randomUUID())
  const [name, setName] = useState(event?.name ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [location, setLocation] = useState(event?.location ?? '')
  const [startDate, setStartDate] = useState(event?.startDate ?? '')
  const [endDate, setEndDate] = useState(event?.endDate ?? '')
  const action = useStorageAction()
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void action.run(() => eventRepository.save(id, { name, description, location, startDate, endDate }, event?.updatedAt), () => { onSaved(event ? 'Evento actualizado.' : 'Evento creado.'); onClose() })
  }
  return <Modal title={event ? 'Editar evento' : 'Nuevo evento'} onClose={onClose} busy={action.saving} protectChanges>
    <form className="catalog-form" onSubmit={submit}>
      {action.error && <p className="storage-error" role="alert">{action.error}</p>}
      <fieldset className="form-fields" disabled={action.saving}>
        <label>Nombre<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Ubicación (opcional)<input maxLength={300} value={location} onChange={e => setLocation(e.target.value)} /></label>
        <div className="form-grid"><label>Fecha de inicio<input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label><label>Fecha de término<input required type="date" min={startDate || undefined} value={endDate} onChange={e => setEndDate(e.target.value)} /></label></div>
        {startDate && endDate && endDate < startDate && <p className="stock-warning" role="alert">La fecha de término no puede ser anterior al inicio.</p>}
        <label>Descripción (opcional)<textarea rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
        {event?.status === 'finished' && <p className="muted">Editar la información no reabre el evento ni cambia las ventas anteriores.</p>}
      </fieldset>
      <div className="form-actions"><button type="button" className="button secondary" disabled={action.saving} onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={action.saving || (!!startDate && !!endDate && endDate < startDate)}>{action.saving ? 'Guardando…' : 'Guardar evento'}</button></div>
    </form>
  </Modal>
}
