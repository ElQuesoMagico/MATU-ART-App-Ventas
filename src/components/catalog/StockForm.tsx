import { useState, type FormEvent } from 'react'
import type { CatalogProduct, MovementInput } from '../../types/catalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { catalogRepository } from '../../services/catalogRepository'
import { Modal } from '../Modal'
export function StockForm({ product, onClose, onSaved }: { product: CatalogProduct; onClose: () => void; onSaved: (message: string) => void }) {
  const action = useStorageAction()
  const [id] = useState(() => crypto.randomUUID())
  const [type, setType] = useState<MovementInput['type']>(product.stockCountPending?'count':'restock')
  const [quantity, setQuantity] = useState('')
  const [direction, setDirection] = useState('add')
  const [cost, setCost] = useState(product.estimatedUnitCost === undefined ? '' : String(product.estimatedUnitCost))
  const [reason, setReason] = useState('')
  const value = Number(quantity) * (type === 'adjustment' && direction === 'subtract' ? -1 : 1)
  const nextStock = type === 'count' ? value : product.stock + value
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void action.run(() => catalogRepository.recordMovement({ id, productId: product.id, type, quantity: value, unitCost: type === 'restock' && cost !== '' ? Number(cost) : undefined, reason, expectedRevision: product.revision }), () => { onSaved('Movimiento registrado.'); onClose() })
  }
  return <Modal title="Ajustar stock" onClose={onClose} busy={action.saving} protectChanges><form className="catalog-form" onSubmit={submit}>
    <p><strong>{product.name}</strong> · Stock actual: {product.stockCountPending?'Pendiente de conteo':product.stock}</p>
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}
    <fieldset className="form-fields" disabled={action.saving}>
      <label>Tipo de movimiento<select disabled={product.stockCountPending} value={type} onChange={event => setType(event.target.value as MovementInput['type'])}><option value="restock">Reposición</option><option value="adjustment">Ajuste manual</option><option value="count">Conteo físico</option></select></label>
      {type === 'adjustment' && <label>Operación<select value={direction} onChange={event => setDirection(event.target.value)}><option value="add">Agregar unidades</option><option value="subtract">Restar unidades</option></select></label>}
      <label>{type === 'count' ? 'Stock contado' : 'Unidades'}<input autoFocus type="number" required step="1" min={type === 'count' ? '-1000000000' : '1'} max="1000000000" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
      {type === 'restock' && <label>Costo unitario (CLP, opcional)<input type="number" min="0" step="1" max="1000000000" value={cost} onChange={event => setCost(event.target.value)} /><small>{product.estimatedUnitCost !== undefined && 'Sugerido desde el costo estimado; puedes cambiarlo. '}Vacío: desconocido. 0: sin costo. La reposición no modifica el estimado.</small></label>}
      <label>Motivo (opcional)<textarea rows={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {quantity !== '' && <p className={nextStock < 0 ? 'stock-warning' : 'cost-summary'} role="status">Stock resultante: <strong>{nextStock}</strong>{nextStock < 0 && '. Atención: quedará stock negativo.'}</p>}
    </fieldset>
    <div className="form-actions"><button className="button secondary" type="button" disabled={action.saving} onClick={onClose}>Cancelar</button><button className="button primary" disabled={action.saving}>{action.saving ? 'Guardando…' : 'Registrar movimiento'}</button></div>
  </form></Modal>
}
