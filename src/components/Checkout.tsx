import { useState, type FormEvent } from 'react'
import type { Cart } from '../hooks/useCart'
import type { CheckoutItem, StoredSale } from '../types/sales'
import { useCatalog } from '../hooks/useCatalog'
import { useStorageAction } from '../hooks/useStorageAction'
import { promotionPricingSignature } from '../services/promotionRules'
import { discountLabel } from '../utils/discounts'
import { calculateSaleStock } from '../services/saleRules'
import { salesRepository } from '../services/salesRepository'
import { money } from '../utils/format'
import { paymentLabels } from '../utils/sales'
import { evaluatePaymentAmounts, initialPaymentAmounts, paymentMethods } from '../services/paymentEntry'
import { Modal } from './Modal'
export function Checkout({ cart, onBack, onSaved }: { cart: Cart; onBack: () => void; onSaved: (sale: StoredSale) => void }) {
  const catalog = useCatalog()
  const action = useStorageAction()
  const [operationId] = useState(cart.operationId)
  // Copia revisada al entrar: cambios posteriores se detectan dentro de la transacción.
  const [lines] = useState(() => cart.lines.map(line => ({ product: { ...line.product }, priceSnapshot: { ...line.priceSnapshot }, quantity: line.quantity, discount: line.discount ? { ...line.discount } : undefined })))
  const [priceReview] = useState(() => ({ ...cart.priceContext }))
  const [reviewSignature] = useState(cart.reviewSignature)
  const reviewChanged = reviewSignature !== cart.reviewSignature
  const [generalDiscount] = useState(cart.generalDiscount ? { ...cart.generalDiscount } : undefined)
  const [pricing] = useState(() => structuredClone(cart.pricing!))
  const total = pricing.total
  const [amounts, setAmounts] = useState(cart.paymentDraft?.reviewTotal === total ? cart.paymentDraft.amounts : initialPaymentAmounts(total))
  const activeEvent = catalog.realEvents.find(event => event.status === 'active')
  const back = () => { cart.setPaymentDraft({ amounts, reviewTotal: total }); onBack() }
  const { payments: paymentInputs, paid, difference, validAmounts, valid } = evaluatePaymentAmounts(amounts, total)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reviewChanged || catalog.loading || catalog.error) { action.setError('El evento, catálogo o descuentos cambiaron. Vuelve al carrito para revisar el total.'); return }
    if (!valid) { action.setError('Los pagos deben ser enteros no negativos y sumar exactamente el total.'); return }
    const items: CheckoutItem[] = lines.map(line => ({ productId: line.product.id, quantity: line.quantity, unitPrice: line.priceSnapshot.unitPrice, expectedRevision: line.product.revision, discount: line.discount }))
    void action.run(async () => {
      try { return await salesRepository.confirm({ operationId, items, payments: paymentInputs, generalDiscount, pricingSignature: promotionPricingSignature(pricing), priceReview }) }
      catch (error) { await catalog.reload(); throw error }
    }, sale => { cart.clear(); onSaved(sale) })
  }
  return <Modal title="Pago" onClose={back} busy={action.saving} headerAction={<span className="checkout-header-total">Total <strong>{money(total)}</strong></span>}><form className="catalog-form" onSubmit={submit}>
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}
    {reviewChanged && <p className="storage-error" role="alert">El evento, los precios o descuentos cambiaron. Vuelve al carrito para revisar antes de confirmar.</p>}
    <fieldset className="form-fields" disabled={action.saving}>
      <div className="checkout-review">{lines.map(line => { const stock = calculateSaleStock(line.product.stock, line.quantity); return <article key={line.product.id}><div className="section-heading"><strong>{line.quantity} × {line.product.name}</strong><strong>{!!pricing.lines.find(item => item.productId === line.product.id)?.appliedDiscount?.amount || !!pricing.lines.find(item => item.productId === line.product.id)?.promotionDiscount ? <del>{money(line.priceSnapshot.unitPrice * line.quantity)}</del> : null} {money(pricing.lines.find(item => item.productId === line.product.id)!.netAmount)}</strong></div><small>{money(line.priceSnapshot.unitPrice)} por unidad</small>{line.priceSnapshot.source === 'event' && <small className="event-price-label">Precio de evento</small>}{line.discount && <p className="discount-note">Descuento de línea: {discountLabel(line.discount)}</p>}{stock.uncoveredQuantity > 0 && <p className="stock-warning">Disponibles: {stock.previousStock}. Vendidas: {stock.quantitySold}. Se descontarán {stock.quantityDeducted}; stock final {stock.resultingStock}. Diferencia no cubierta: {stock.uncoveredQuantity}.</p>}</article> })}</div>
      {pricing.discount > 0 && <div className="cost-summary"><p>Subtotal original: {money(pricing.subtotal)}</p><p>Descuentos: −{money(pricing.discount)}</p>{generalDiscount && <p>Descuento general: {discountLabel(generalDiscount)} · −{money(pricing.appliedGeneralDiscount!.amount)}</p>}<p>Total final: {money(total)}</p></div>}
      {(!!pricing.promotions.length || !!pricing.combos.length) && <div className="promotion-applied" aria-label="Promociones aplicadas"><strong>Ofertas automáticas</strong>{pricing.combos.map(combo=><p key={combo.id}>{combo.configuration.type === 'quantity' ? 'Oferta' : 'Combo'} {combo.name} × {combo.applications}: −{money(combo.amount)}</p>)}{pricing.promotions.map(p => <p key={p.id}>{p.name}: −{money(p.amount)}</p>)}</div>}
      <div className="form-grid">{paymentMethods.map(key => <label key={key}>{paymentLabels[key]} (CLP)<input type="text" inputMode="numeric" pattern="[0-9]*" value={amounts[key]} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} onChange={event => { setAmounts(current => ({ ...current, [key]: event.target.value })); action.setError('') }} /></label>)}</div>
      <p className={valid ? 'cost-summary' : 'stock-warning'} role="status" aria-live="polite">{!validAmounts ? 'Ingresa importes enteros no negativos en CLP.' : <>Ingresado: {money(paid)} · {difference > 0n ? `Falta: ${money(difference)}` : difference < 0n ? `Excede: ${money(-difference)}` : 'Pago completo'}</>}</p>
      <p className="muted" aria-live="polite">{activeEvent ? `Evento activo: ${activeEvent.name}.` : 'Sin evento activo.'} Se utiliza el evento vigente al confirmar.</p>
    </fieldset>
    <div className="form-actions"><button type="button" className="button secondary" disabled={action.saving} onClick={back}>Volver al carrito</button><button type="submit" className="button primary" disabled={action.saving || !valid || !lines.length || reviewChanged || catalog.loading || !!catalog.error}>{action.saving ? 'Guardando venta…' : 'Confirmar venta'}</button></div>
  </form></Modal>
}

