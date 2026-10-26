import { ReverseMovementForm } from './ReverseMovementForm'
import { canReverseMovement } from '../../services/movementReversal'
import { useEffect, useState } from 'react'
import type { CatalogProduct, EstimatedCostChange, InventoryMovement } from '../../types/catalog'
import { useCatalog } from '../../hooks/useCatalog'
import { catalogRepository } from '../../services/catalogRepository'
import { storageError } from '../../services/catalogValidation'
import { movementLabels } from '../../utils/catalog'
import { money } from '../../utils/format'
import { saleNumber } from '../../utils/sales'
import { Modal } from '../Modal'
import { EmptyState } from '../ui'
const costLabel = (value?: number) => value === undefined ? 'Desconocido' : money(value)
const timestamp = (value: string) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(value))
export function MovementHistory({ product, onClose }: { product?: CatalogProduct; onClose: () => void }) {
  const { products, sales } = useCatalog()
  const [productId, setProductId] = useState(product?.id ?? 'all')
  const [type, setType] = useState<InventoryMovement['type'] | 'all'>('all')
  const [view, setView] = useState<'stock' | 'cost'>('stock')
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [costChanges, setCostChanges] = useState<EstimatedCostChange[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reversing, setReversing] = useState<InventoryMovement>()
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let mounted = true
    Promise.all([
      catalogRepository.listMovements({ productId: productId === 'all' ? undefined : productId, type: type === 'all' ? undefined : type }),
      catalogRepository.estimatedCostHistory(productId === 'all' ? undefined : productId),
    ]).then(([movements, changes]) => { if (mounted) { setMovements(movements); setCostChanges(changes); setError('') } }).catch(error => { if (mounted) setError(storageError(error)) }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [productId, type, products])
  const productName = (id: string) => { const item = products.find(item => item.id === id); return item ? `${item.name}${item.isArchived ? ' (archivado)' : ''}` : `Producto ${id}` }
  const associatedSale = (id: string) => { const sale = sales.find(sale => sale.id === id); return sale ? saleNumber(sale.number) : id }
  return <><Modal title="Historial de inventario" onClose={onClose}>
    {notice && <p className="save-notice" role="status">{notice}</p>}
    <div className="category-filters"><button className={`filter-chip ${view === 'stock' ? 'selected' : ''}`} aria-pressed={view === 'stock'} onClick={() => setView('stock')}>Movimientos</button><button className={`filter-chip ${view === 'cost' ? 'selected' : ''}`} aria-pressed={view === 'cost'} onClick={() => setView('cost')}>Costos estimados</button></div>
    <div className="toolbar"><label className="select-field">Producto<select value={productId} onChange={event => { setLoading(true); setProductId(event.target.value) }}><option value="all">Todos los productos</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}{item.isArchived && ' (archivado)'}</option>)}</select></label>{view === 'stock' && <label className="select-field">Tipo<select value={type} onChange={event => { setLoading(true); setType(event.target.value as typeof type) }}><option value="all">Todos los movimientos</option>{Object.entries(movementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}</div>
    {error ? <p className="storage-error" role="alert">{error}</p> : loading ? <p className="muted">Cargando historial…</p> : view === 'stock' ? movements.length ? <div className="movement-list">{movements.map(movement => <article key={movement.id}><p className="modal-product-name">{productName(movement.productId)}</p><div className="section-heading"><strong>{movementLabels[movement.type]}</strong><strong>{movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange} uds.</strong></div><p>Stock: {movement.previousStockUnknown?'Desconocido (base técnica)':movement.previousStock} → {movement.resultingStock}</p><small>{timestamp(movement.createdAt)}</small><p>Motivo: {movement.reason || 'Sin motivo registrado'}</p>{(['restock', 'initial', 'sale', 'sale_void', 'manual_reversal'].includes(movement.type)) && <p>Costo unitario: {costLabel(movement.unitCost)}</p>}{movement.saleId && <p>Venta asociada: {associatedSale(movement.saleId)}</p>}{movement.type === 'sale' && <p>Unidades vendidas: {movement.requestedQuantity} · Diferencia no cubierta: {movement.uncoveredQuantity ?? 0}</p>}<details><summary>Identificadores del movimiento</summary><p><code>{movement.id}</code></p>{movement.reversesMovementId && <p>Original: <code>{movement.reversesMovementId}</code></p>}{movement.reversedById && <p>Compensación: <code>{movement.reversedById}</code></p>}</details>{movement.reversedById && <p className="badge neutral">Revertido</p>}{movement.costReversalPolicy && <p className="muted">{movement.costReversalPolicy === 'restored' ? 'Costos previos restaurados.' : 'Costos conservados; promedio provisional.'}</p>}{canReverseMovement(movement) && <button type="button" className="button secondary" onClick={() => setReversing(movement)}>Revertir movimiento</button>}</article>)}</div> : <EmptyState title="Sin movimientos" description="No hay movimientos para estos filtros." /> : costChanges.length ? <div className="movement-list">{costChanges.map(change => <article key={change.id}><p className="modal-product-name">{productName(change.productId)}</p><strong>{costLabel(change.previousValue)} → {costLabel(change.newValue)}</strong><p>{timestamp(change.createdAt)}</p><p>Motivo: {change.reason || 'Sin motivo registrado'}</p><details><summary>ID del cambio</summary><code>{change.id}</code></details></article>)}</div> : <EmptyState title="Sin cambios de costo estimado" description="Los cambios manuales se registrarán aquí." />}
  </Modal>{reversing && products.find(item => item.id === reversing.productId) && <ReverseMovementForm movement={reversing} product={products.find(item => item.id === reversing.productId)!} onClose={() => setReversing(undefined)} onSaved={() => { setReversing(undefined); setNotice('Movimiento revertido. Se conserva el registro original.') }} />}</>
}
