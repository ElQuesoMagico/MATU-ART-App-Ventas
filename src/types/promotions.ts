export interface ComboComponent { id: string; kind: 'product' | 'category'; targetId: string; quantity: number }
export interface Promotion {
  type: 'percentage' | 'fixed' | 'combo' | 'quantity'; value: number; components?: ComboComponent[]
  id: string; name: string; description?: string
  eventIds?: string[]; groupQuantity?: number
  productIds: string[]; categoryIds: string[]; familyIds: string[]; ipIds: string[]
  minimumQuantity: number; minimumAmount: number
  startDate?: string; endDate?: string
  isActive: boolean; isArchived: boolean; isStackable: boolean
  createdAt: string; updatedAt: string
}
export interface AppliedPromotion {
  id: string; name: string; type: Promotion['type']; value: number; amount: number
  products: { productId: string; quantity: number; amount: number }[]
  configuration: Promotion
}

export interface AppliedCombo {
  id: string; name: string; price: number; applications: number; originalAmount: number; amount: number
  configuration: Promotion
  products: { productId: string; quantity: number; originalAmount: number; amount: number }[]
  occurrences: { originalAmount: number; baseAmount: number; amount: number; products: { productId: string; quantity: number; originalAmount: number; amount: number }[] }[]
}
