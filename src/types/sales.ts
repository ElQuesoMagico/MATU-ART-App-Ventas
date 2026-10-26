import type { AppliedPromotion, AppliedCombo } from './promotions'
import type { ManualDiscount, AppliedDiscount } from './discounts'
import type { SaleCostSnapshot } from './catalog'
import type { SaleStockResult } from '../services/saleRules'
import type { PriceReviewContext, ProductPriceSnapshot } from '../services/productPricing'
export type PaymentMethod = 'cash' | 'transfer' | 'debit'
export interface PaymentInput { method: PaymentMethod; amount: number }
export interface PaymentDraft { reviewTotal?: number; amounts: Record<PaymentMethod, string> }
export interface StoredPayment extends PaymentInput { id: string; saleId: string; createdAt: string }
/** Formato legacy conservado únicamente en el almacén events anterior a v8. */
export interface RealSalesEvent { id: string; name: string; isActive: boolean; createdAt: string }
export interface CheckoutItem {
  productId: string
  quantity: number
  unitPrice: number
  discount?: ManualDiscount
  expectedRevision: number
}
// eventId solo conserva la firma de reintentos anteriores; nuevas ventas ignoran
// selecciones externas y leen managedEvents dentro de su transacción.
export interface CheckoutInput { operationId: string; items: CheckoutItem[]; payments: PaymentInput[]; eventId?: string; generalDiscount?: ManualDiscount; pricingSignature?: string; priceReview?: PriceReviewContext }
export interface StoredSaleItem {
  productId: string
  productKind?: 'product' | 'pack'
  packContents?: { productId: string; name: string; quantity: number }[]
  name: string
  description?: string
  categoryIds: string[]
  quantity: number
  unitPrice: number
  priceSnapshot?: ProductPriceSnapshot
  lineTotal: number
  netLineTotal?: number
  promotionDiscount?: number
  appliedDiscount?: AppliedDiscount
  cost: SaleCostSnapshot
  stock: SaleStockResult
}
export interface StoredSale {
  historicalSource?: import('./imports').HistoricalSource
  id: string
  operationId: string
  operationFingerprint: string
  number: number
  soldAt: string
  createdAt: string
  items: StoredSaleItem[]
  subtotal: number
  discount: number
  generalDiscount?: AppliedDiscount
  calculationVersion?: 'manual-v1' | 'promotions-v1' | 'combos-v1'
  appliedPromotions?: AppliedPromotion[]
  appliedCombos?: AppliedCombo[]
  total: number
  payments: StoredPayment[]
  event?: { id: string; name: string }
  status: 'completed' | 'voided'
  stockDifferences: { productId: string; quantity: number }[]
  movementIds: string[]
  voidAudit?: { operationId: string; reason: string; returnStock: boolean; voidedAt: string; movementIds: string[] }
}
export interface VoidSaleInput { saleId: string; operationId: string; reason: string; returnStock: boolean }
