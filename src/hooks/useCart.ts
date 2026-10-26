import { useEffect, useState } from 'react'
import type { ManualDiscount } from '../types/discounts'
import { calculatePromotionPricing, promotionPricingSignature } from '../services/promotionRules'
import { priceReviewContext, resolveProductPrice } from '../services/productPricing'
import { calculateSalePricing } from '../services/discountRules'
import { storageError } from '../services/catalogValidation'
import { useCatalog } from './useCatalog'
import type { CartItem } from '../types'
import type { PaymentDraft } from '../types/sales'
export function useCart() {
  const [generalDiscount, setGeneralDiscount] = useState<ManualDiscount>()
  const [items, setItems] = useState<CartItem[]>([])
  const [operationId, setOperationId] = useState<string>(() => crypto.randomUUID())
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>()
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const refresh = () => setClock(Date.now()); const interval = setInterval(refresh, 30000); window.addEventListener('focus', refresh); return () => { clearInterval(interval); window.removeEventListener('focus', refresh) } }, [])
  const { products: allProducts, promotions, realEvents, eventRevision } = useCatalog()
  const priceContext = priceReviewContext(realEvents, eventRevision)
  const products = allProducts.filter(product => !product.isArchived)
  function changeQuantity(productId: string, delta: number) {
    const product = products.find(item => item.id === productId)
    if (!product) return
    setItems(current => {
      const quantity = Math.max(0, (current.find(item => item.productId === productId)?.quantity ?? 0) + delta)
      const rest = current.filter(item => item.productId !== productId)
      if (!quantity) return rest
      return current.some(item => item.productId === productId) ? current.map(item => item.productId === productId ? { ...item, quantity } : item) : [...rest, { productId, quantity }]
    })
  }
  const lines = items.flatMap(item => { const product = products.find(product => product.id === item.productId); return product ? [{ ...item, product, priceSnapshot: resolveProductPrice(product, priceContext.eventId ?? undefined) }] : [] })
  let generalDiscountBase = 0
  let pricing: ReturnType<typeof calculatePromotionPricing> | undefined
  let pricingError = ''
  try {
    const input = lines.map(line => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.priceSnapshot.unitPrice, hasEventPrice: line.priceSnapshot.source === 'event', discount: line.discount, categoryId: line.product.categoryId, familyIds: line.product.familyIds, ipIds: line.product.ipIds }))
    generalDiscountBase = calculateSalePricing(input).remainingSubtotal
    pricing = calculatePromotionPricing(input, promotions, generalDiscount, new Date(clock).toISOString(), priceContext.eventId ?? undefined)
    generalDiscountBase = pricing.remainingSubtotal
  } catch (error) { pricingError = storageError(error) }

  const reviewSignature = JSON.stringify({ priceContext, products: lines.map(line => ({ id: line.product.id, revision: line.product.revision, price: line.priceSnapshot })), pricing: pricing ? promotionPricingSignature(pricing) : pricingError })
  return { lines, pricing, pricingError, priceContext, reviewSignature, generalDiscountBase, generalDiscount, setGeneralDiscount,
    setLineDiscount: (productId: string, discount?: ManualDiscount) => setItems(current => current.map(item => item.productId === productId ? { ...item, discount } : item)),
    operationId, paymentDraft, setPaymentDraft, changeQuantity,
    clear: () => { setItems([]); setGeneralDiscount(undefined); setPaymentDraft(undefined); setOperationId(crypto.randomUUID()) },
    remove: (id: string) => setItems(current => current.filter(item => item.productId !== id)),
    total: pricing?.total ?? 0, count: lines.reduce((sum, item) => sum + item.quantity, 0) }
}
export type Cart = ReturnType<typeof useCart>
