import { useState } from 'react'
import type { CatalogClassification, ClassificationKind } from '../../types/catalog'
import { Modal } from '../Modal'
import { QuickClassification } from './QuickClassification'
export function QuickClassificationDialog({kind,onClose,onCreated,onBusy,standalone=false}:{kind:ClassificationKind;onClose:()=>void;onCreated:(item:CatalogClassification)=>void;onBusy?:(busy:boolean)=>void;standalone?:boolean}) {
  const [busy,setBusy]=useState(false)
  return <Modal title="Crear clasificación" onClose={onClose} busy={busy} protectChanges><QuickClassification standalone={standalone} kind={kind} onCancel={onClose} onCreated={onCreated} onBusy={value=>{setBusy(value);onBusy?.(value)}} /></Modal>
}
