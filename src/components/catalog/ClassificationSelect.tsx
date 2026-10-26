import { useEffect, useId, useRef, useState } from 'react'
import type { CatalogClassification } from '../../types/catalog'
import { classificationOptions, sameClassificationSelection, toggleClassification } from '../../services/selectionRules'
import { Ornament } from '../Ornament'
export function ClassificationSelect({ label, items, selected, onChange, assign = false, single = false, onCreate, emptyLabel, invalid = false, describedBy }: { label: string; items: CatalogClassification[]; selected: string[]; onChange: (ids: string[]) => void; assign?: boolean; single?: boolean; onCreate?: () => void; emptyLabel?: string; invalid?: boolean; describedBy?: string }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const options = classificationOptions(items, selected, query, assign)
  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus() }
  function commit() { if (!sameClassificationSelection(draft, selected)) onChange(draft); close() }
  useEffect(() => {
    if (!open) return
    const element = dialog.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.showModal()
    element?.querySelector<HTMLInputElement>('input[type=search]')?.focus()
    const viewport = window.visualViewport
    const resize = () => {
      element?.style.setProperty('--selector-height', `${Math.max(160, (viewport?.height ?? window.innerHeight) - 24)}px`)
      element?.style.setProperty('--selector-bottom', `${Math.max(8, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0) + 8)}px`)
    }
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize)
    return () => { document.body.style.overflow = previousOverflow; viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); element?.close() }
  }, [open])
  const chosen = single ? items.find(item => item.id === selected[0])?.name : undefined
  return <div className="classification-select">
    <div className="classification-trigger-row"><button ref={trigger} type="button" className="classification-trigger" aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid} aria-describedby={describedBy} onClick={() => { setQuery(''); setDraft([...selected]); setOpen(true) }}>{label} <span className="badge neutral">{chosen || selected.length || emptyLabel || (assign ? 'Sin asignar' : 'Todas')}</span></button>{onCreate && <button className="text-button" type="button" aria-label={`Crear ${label}`} onClick={onCreate}>+</button>}</div>
    {!single && !!selected.length && <div className="classification-tags">{selected.map(id => { const item = items.find(item => item.id === id); return <button key={id} className="filter-chip selected" type="button" aria-label={`Quitar ${item?.name ?? id} de ${label}`} onClick={() => onChange(selected.filter(value => value !== id))}>{item?.name ?? 'No disponible'}{item && !item.isActive && ' (archivada)'} ×</button> })}</div>}
    {open && <dialog ref={dialog} className="classification-layer" aria-labelledby={titleId} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }} onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close() } }}>
      <header><strong id={titleId}><Ornament size={15} />{label}</strong><button type="button" className="text-button" aria-label={`Cerrar selector de ${label}`} onClick={close}>×</button></header>
      <input aria-label={`Buscar ${label}`} type="search" placeholder="Buscar…" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="classification-option-list" aria-label={`Opciones de ${label}`}>{options.map(item => <button className={`classification-option ${draft.includes(item.id) ? 'is-selected' : ''}`} type="button" aria-pressed={draft.includes(item.id)} key={item.id} onClick={() => setDraft(current => toggleClassification(current, item.id, single))}><span>{item.name}{!item.isActive && <small>Archivada</small>}</span>{draft.includes(item.id) && <span className="selection-mark" aria-hidden="true">✓</span>}</button>)}{!options.length && <p className="muted">No hay coincidencias.</p>}</div>
      <footer><button type="button" className="button secondary" disabled={!onCreate} onClick={() => { commit(); onCreate?.() }}>Crear</button><button type="button" className="button primary" onClick={commit}>Listo{draft.length > 0 && ` (${draft.length})`}</button></footer>
    </dialog>}
  </div>
}
