import { useEffect, useRef, useState } from 'react'
import { entityKinds, entityLabels, type EntityKind } from '../../services/entityAdministration'
export function CreateEntityMenu({ disabled, onSelect }: { disabled: boolean; onSelect: (kind: EntityKind) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close) }, [open])
  return <div ref={root} className="create-entity-menu" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }}><button className="button primary" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>+ Crear nuevo</button>{open && <div className="create-entity-options" aria-label="Crear nuevo">{entityKinds.map(kind => <button type="button" key={kind} onClick={() => { setOpen(false); onSelect(kind) }}>{entityLabels[kind]}</button>)}</div>}</div>
}
