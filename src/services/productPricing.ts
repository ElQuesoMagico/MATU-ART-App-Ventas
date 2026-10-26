import type { CatalogProduct } from '../types/catalog.ts'
import type { CatalogEvent } from '../types/events.ts'
export interface PriceReviewContext { eventId: string | null; revision: number }
export interface ProductPriceSnapshot { unitPrice: number; generalPrice: number; source: 'general' | 'event'; eventId?: string }
export function resolveProductPrice(product: Pick<CatalogProduct, 'price' | 'eventPrices'>, activeEventId?: string): ProductPriceSnapshot {
  const exception = activeEventId ? product.eventPrices?.find(price => price.eventId === activeEventId) : undefined
  return { unitPrice: exception?.price ?? product.price, generalPrice: product.price, source: exception ? 'event' : 'general', eventId: exception ? activeEventId : undefined }
}
export const priceReviewContext = (events: CatalogEvent[], revision: number): PriceReviewContext => ({ eventId: events.find(event => event.status === 'active')?.id ?? null, revision })
export const samePriceContext = (a: PriceReviewContext, b: PriceReviewContext) => a.eventId === b.eventId && a.revision === b.revision
