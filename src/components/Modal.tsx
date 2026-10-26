import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { modalDismissal } from '../services/modalRules'
import { Ornament } from './Ornament'
import { Icon } from './Icon'
export function Modal({ title, children, onClose, busy = false, protectChanges = false, hasChanges, headerAction }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; protectChanges?: boolean; hasChanges?: boolean; headerAction?: ReactNode }) {
  const pendingNavigation = useRef<string | undefined>(undefined)
  const titleId = useId()
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const requestClose = () => { const decision = modalDismissal(busy, hasChanges ?? dirty, protectChanges); if (decision === 'confirm') setDiscard(true); else if (decision === 'close') onClose() }
  useEffect(() => {
    if (!protectChanges || !(hasChanges ?? dirty)) return
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [protectChanges, hasChanges, dirty])
  useEffect(() => {
    const navigate = (event: Event) => {
      if (busy || (protectChanges && (hasChanges ?? dirty))) { event.preventDefault(); if (!busy) { pendingNavigation.current = (event as CustomEvent<string>).detail; setDiscard(true) } }
    }
    window.addEventListener('clown-before-navigation', navigate)
    return () => window.removeEventListener('clown-before-navigation', navigate)
  }, [busy, protectChanges, hasChanges, dirty])
  const dialog = useRef<HTMLDialogElement>(null)
  const initialFocus = useRef<Element | null>(null)
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    initialFocus.current = document.activeElement
    dialog.current?.showModal()
    dialog.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
    const element = dialog.current
    return () => { document.body.style.overflow = previousOverflow; element?.close(); if (initialFocus.current instanceof HTMLElement) initialFocus.current.focus() }
  }, [])
  return <dialog ref={dialog} className="catalog-modal" aria-labelledby={titleId} onClickCapture={event => { if ((event.target as Element).closest('[data-close-modal]') && (event.target as Element).closest('dialog') === event.currentTarget) { event.stopPropagation(); requestClose() } }} onInputCapture={() => { if (protectChanges && hasChanges === undefined) setDirty(true) }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose() } }} onCancel={event => { event.preventDefault(); event.stopPropagation(); requestClose() }}>
    <div className="modal-header"><button className="text-button modal-back" type="button" disabled={busy} onClick={requestClose}>Volver</button><h2 id={titleId}><Ornament size={16} />{title}</h2>{headerAction}<button className="icon-button" type="button" disabled={busy} onClick={requestClose} aria-label="Cerrar"><Icon name="close" /></button></div>{discard && <div className="stock-warning" role="alert"><p>Hay cambios sin guardar. ¿Quieres descartarlos?</p><button type="button" className="button secondary" disabled={busy} onClick={() => { pendingNavigation.current = undefined; setDiscard(false) }}>Seguir editando</button><button type="button" className="button secondary" disabled={busy} onClick={() => { if (!busy) { onClose(); if (pendingNavigation.current) window.location.hash = pendingNavigation.current } }}>Descartar y cerrar</button></div>}<div className="modal-content">{children}</div>
  </dialog>
}
