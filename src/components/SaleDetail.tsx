import { useState, type FormEvent } from 'react'
import type { StoredSale } from '../types/sales'
import { useCatalog } from '../hooks/useCatalog'
import { useStorageAction } from '../hooks/useStorageAction'
import { salesRepository } from '../services/salesRepository'
import { money, dateTimeLabel } from '../utils/format'
import { paymentLabels, saleCostLabel, saleNumber } from '../utils/sales'
import { discountLabel } from '../utils/discounts'
import { Modal } from './Modal'
export function SaleDetail({ sale: initialSale, onClose }: { sale: StoredSale; onClose: () => void }) {
  const { sales } = useCatalog()
  const [saved, setSaved] = useState(initialSale)
  const sale = saved.status === 'voided' ? saved : sales.find(item => item.id === initialSale.id) ?? saved
  const action = useStorageAction()
  const [voiding, setVoiding] = useState(false)
  const [operationId] = useState(() => crypto.randomUUID())
  const [reason, setReason] = useState('')
  const [returnStock, setReturnStock] = useState(false)
  const [notice, setNotice] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void action.run(() => salesRepository.voidSale({ saleId: sale.id, operationId, reason, returnStock }), result => { setSaved(result); setVoiding(false); setNotice('Venta anulada. Se conserva el registro original.') })
  }
  return <Modal title={saleNumber(sale.number)} onClose={onClose} busy={action.saving} protectChanges={voiding} hasChanges={voiding && (!!reason || returnStock)} headerAction={sale.status === 'completed' && !voiding ? <button type="button" className="button secondary" onClick={() => setVoiding(true)}>Anular venta</button> : undefined}>
    {notice && <p className="save-notice" role="status">{notice}</p>}{action.error && <p className="storage-error" role="alert">{action.error}</p>}
    {sale.historicalSource && <p className="stock-warning">Histórica importada · {sale.historicalSource.file} · Fila {sale.historicalSource.row}. Registro de origen independiente; transacción original desconocida. Sin efectos sobre stock local.</p>}
    <p className="muted">{dateTimeLabel(sale.soldAt)} · {sale.event?.name ?? 'Sin evento'}</p><p className={`badge ${sale.status === 'completed' ? 'green' : 'neutral'}`}>{sale.status === 'completed' ? 'Registrada' : 'Anulada'}</p>
    {sale.status === 'completed' && voiding && <form className="catalog-form" onSubmit={submit}><fieldset className="form-fields" disabled={action.saving}><label>Motivo de anulación<textarea autoFocus required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><label className="check-label"><input type="checkbox" disabled={!!sale.historicalSource} checked={returnStock} onChange={event => setReturnStock(event.target.checked)} />Devolver stock</label><p className="muted">Si seleccionas devolver stock, se reintegrarán solo las unidades descontadas. Los pagos originales se conservan; esta acción no realiza una devolución de dinero.</p></fieldset><div className="form-actions"><button className="button secondary" type="button" disabled={action.saving} onClick={() => setVoiding(false)}>Cancelar</button><button className="button primary" disabled={action.saving || !reason.trim()}>{action.saving ? 'Anulando…' : 'Confirmar anulación'}</button></div></form>}
    <div className="movement-list">{sale.items.map(item => <article key={item.productId}><div className="section-heading"><strong>{item.quantity} × {item.name}</strong><strong>{money(item.netLineTotal ?? item.lineTotal)}</strong></div>{item.productKind==='pack'&&<p>Pack · Stock independiente</p>}{!!item.packContents?.length && <details><summary>Contenido documentado del pack</summary>{item.packContents.map(c=><p key={c.productId}>{c.quantity} × {c.name}</p>)}</details>}<p>Precio unitario original: {money(item.unitPrice)}</p>{item.priceSnapshot && <p className="muted">{item.priceSnapshot.source === 'event' ? `Precio de evento · ${sale.event?.name ?? 'Referencia histórica'} · General: ${money(item.priceSnapshot.generalPrice)}` : 'Precio general'}</p>}{item.appliedDiscount && <p>Importe original: {money(item.lineTotal)} · Descuento de línea: {discountLabel(item.appliedDiscount)} (−{money(item.appliedDiscount.amount)}) · Importe de línea: {money(item.netLineTotal ?? item.lineTotal)}</p>}{!!item.promotionDiscount && <p>Promociones en esta línea: −{money(item.promotionDiscount)}</p>}<p>Costo unitario: {saleCostLabel(item)}</p>{!sale.historicalSource && <p>Stock: {item.stock.previousStock} → {item.stock.resultingStock} · Descontadas: {item.stock.quantityDeducted}</p>}{item.stock.uncoveredQuantity > 0 && <p className="stock-warning">Diferencia no cubierta: {item.stock.uncoveredQuantity} unidad(es).</p>}</article>)}</div>
    <div className="cost-summary"><p>Subtotal: {money(sale.subtotal)}</p><p>Descuentos: {money(sale.discount)}</p>{sale.generalDiscount && <p>Descuento general: {discountLabel(sale.generalDiscount)} sobre {money(sale.generalDiscount.baseAmount)} (−{money(sale.generalDiscount.amount)})</p>}<p><strong>Total: {money(sale.total)}</strong></p>{sale.payments.map(payment => <p key={payment.id}>{paymentLabels[payment.method]}: {money(payment.amount)}</p>)}</div>
    {!!sale.appliedPromotions?.length && <div className="promotion-applied"><strong>Promociones aplicadas</strong>{sale.appliedPromotions.map(p => <article key={p.id}><p>{p.name} · {discountLabel(p)} · −{money(p.amount)}</p>{p.products.map(benefit => <small key={benefit.productId}>{benefit.quantity} × {sale.items.find(item => item.productId === benefit.productId)?.name ?? benefit.productId}: −{money(benefit.amount)}</small>)}</article>)}</div>}
    {!!sale.appliedCombos?.length && <div className="promotion-applied"><strong>Ofertas por grupo aplicadas</strong>{sale.appliedCombos.map(combo=><article key={combo.id}><p>{combo.name} · {combo.applications} aplicaciones · Precio por grupo: {money(combo.price)}</p><p>Importe original: {money(combo.originalAmount)} · Ahorro: {money(combo.amount)}</p>{combo.products.map(p=><small key={p.productId}>{p.quantity} × {sale.items.find(item=>item.productId===p.productId)?.name??p.productId} · Original {money(p.originalAmount)} · Descuento {money(p.amount)}</small>)}</article>)}</div>}
    {sale.voidAudit && <div className="stock-warning"><strong>Anulación: {dateTimeLabel(sale.voidAudit.voidedAt)}</strong><p>Motivo: {sale.voidAudit.reason}</p><p>{sale.voidAudit.returnStock ? 'Devolución del stock efectivamente descontado registrada.' : 'Sin devolución de stock.'}</p><p>Los importes de pago originales se conservan para auditoría; no se procesan reembolsos.</p></div>}
    <details className="sale-audit"><summary>Identificadores de auditoría</summary><p>Venta: {sale.id}</p><p>Operación: {sale.operationId}</p>{sale.voidAudit && <p>Anulación: {sale.voidAudit.operationId}</p>}</details>
  </Modal>
}

