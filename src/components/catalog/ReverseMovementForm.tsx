import { useState, type FormEvent } from 'react'
import type { CatalogProduct, InventoryMovement } from '../../types/catalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { catalogRepository } from '../../services/catalogRepository'
import { planMovementReversal } from '../../services/movementReversal'
import { storageError } from '../../services/catalogValidation'
import { money, dateTimeLabel } from '../../utils/format'
import { movementLabels } from '../../utils/catalog'
import { Modal } from '../Modal'

export function ReverseMovementForm({ product, movement, onClose, onSaved }: { product: CatalogProduct; movement: InventoryMovement; onClose: () => void; onSaved: () => void }) {
  const action = useStorageAction()
  const [id] = useState(() => crypto.randomUUID())
  const [reason, setReason] = useState('')
  let plan: ReturnType<typeof planMovementReversal> | undefined
  let error = ''
  try { plan = planMovementReversal(product, movement) } catch (cause) { error = storageError(cause) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan) return
    void action.run(() => catalogRepository.reverseMovement({ id, movementId: movement.id, expectedRevision: product.revision, reason }), onSaved)
  }
  const cost = (value?: number) => value === undefined ? 'Desconocido' : money(value)
  return <Modal title="Revertir movimiento" onClose={onClose} busy={action.saving} protectChanges hasChanges={!!reason}>
    <p className="modal-product-name">{product.name}</p>
    <p>{movementLabels[movement.type]} · {dateTimeLabel(movement.createdAt)}</p>
    {error && <p className="storage-error" role="alert">{error}</p>}
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}
    {plan && <><div className="cost-summary"><p>Cambio compensatorio: <strong>{plan.quantityChange > 0 ? '+' : ''}{plan.quantityChange} uds.</strong></p><p>Stock actual: {product.stock} → <strong>{plan.stock}</strong></p><p>Costo promedio: {cost(product.averageCost)} → {cost(plan.cost.averageCost)}</p><p>Último costo: {cost(product.lastKnownCost)} → {cost(plan.cost.lastKnownCost)}</p></div>
      {plan.stock < 0 && <p className="stock-warning" role="alert">El stock quedará negativo: {plan.stock} unidades.</p>}
      <p className={plan.costReversalPolicy === 'provisional' ? 'stock-warning' : 'muted'}>{plan.costReversalPolicy === 'restored' ? 'Se restaurarán los costos previos registrados. El costo estimado no cambia.' : 'Hay cambios posteriores o no existe una copia de los costos previos. Se conservarán los costos actuales y el promedio quedará provisional.'}</p>
      <p className="muted">Se conservará el movimiento original y se registrará esta compensación. Las ventas históricas no cambian.</p></>}
    <form className="catalog-form" onSubmit={submit}><fieldset className="form-fields" disabled={action.saving}><label>Motivo de reversión<textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label></fieldset><div className="form-actions"><button type="button" data-close-modal className="button secondary" disabled={action.saving}>Cancelar</button><button type="submit" className="button primary" disabled={!plan || action.saving || !reason.trim()}>{action.saving ? 'Revirtiendo…' : 'Confirmar reversión'}</button></div></form>
  </Modal>
}
