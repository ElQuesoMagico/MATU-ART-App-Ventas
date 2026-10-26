import { useState } from 'react'
import type { CatalogClassification, ClassificationKind } from '../../types/catalog'
import { Modal } from '../Modal'
import { QuickClassification } from './QuickClassification'
export function QuickClassificationDialog({kind,onClose,onCreated,onBusy}:{kind:ClassificationKind;onClose:()=>void;onCreated:(item:CatalogClassification)=>void;onBusy?:(busy:boolean)=>void}) {
  const [busy,setBusy]=useState(false)
  return <Modal title="Crear clasificación" onClose={onClose} busy={busy} protectChanges><QuickClassification kind={kind} onCancel={onClose} onCreated={onCreated} onBusy={value=>{setBusy(value);onBusy?.(value)}} /></Modal>
}
