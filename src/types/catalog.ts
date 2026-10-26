export interface PackContent { productId: string; quantity: number }
export interface ProductEventPrice { eventId: string; price: number }
export interface CatalogProduct {
  kind?: 'product' | 'pack'
  packContents?: PackContent[]
  id: string
  name: string
  description?: string
  categoryIds: string[]
  categoryId?: string
  classificationPending?: boolean
  familyIds?: string[]
  ipIds?: string[]
  price: number
  eventPrices?: ProductEventPrice[]
  stock: number
  /** Numeric stock is only a technical baseline until a verified physical count. */
  stockCountPending?: boolean
  lowStockThreshold: number
  averageCost?: number
  lastKnownCost?: number
  estimatedUnitCost?: number
  averageCostIsProvisional: boolean
  image?: Blob
  isFavorite: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
  revision: number
  /** Índice único: ausente en productos archivados. */
  activeName?: string
}
export interface CatalogCategory {
  description?: string
  normalizedName?: string
  id: string
  name: string
  isActive: boolean
  order: number
  createdAt: string
  updatedAt: string
  activeName?: string
}
export type MovementType = 'initial' | 'restock' | 'adjustment' | 'count' | 'sale' | 'sale_void' | 'manual_reversal'
export type InventoryCostState = Pick<CatalogProduct, 'averageCost' | 'lastKnownCost' | 'averageCostIsProvisional'>
export interface ReverseMovementInput { id: string; movementId: string; expectedRevision: number; reason: string }
export interface InventoryMovement {
  previousStockUnknown?: boolean
  id: string
  productId: string
  type: MovementType
  quantityChange: number
  previousStock: number
  resultingStock: number
  createdAt: string
  reason?: string
  unitCost?: number
  requestedQuantity: number
  saleId?: string
  uncoveredQuantity?: number
  costBefore?: InventoryCostState
  costAfter?: InventoryCostState
  productRevisionAfter?: number
  reversedById?: string
  reversesMovementId?: string
  costReversalPolicy?: 'restored' | 'provisional'
}
export interface ProductFields {
  kind?: 'product' | 'pack'
  packContents?: PackContent[]
  name: string
  description?: string
  categoryIds: string[]
  categoryId?: string
  classificationPending?: boolean
  familyIds?: string[]
  ipIds?: string[]
  price: number
  eventPrices?: ProductEventPrice[]
  lowStockThreshold: number
  image?: Blob
  isFavorite: boolean
  estimatedUnitCost?: number
}
export interface EstimatedCostChange {
  id: string
  productId: string
  previousValue?: number
  newValue?: number
  createdAt: string
  reason?: string
}
/** Copia inmutable de valores, para las líneas de venta de la Etapa 3. */
export interface SaleCostSnapshot {
  /** Optional for legacy receipts. */
  condition?: 'known' | 'estimated' | 'provisional' | 'unknown'
  unitCost?: number
  source: 'estimated' | 'average' | 'last-known' | 'unknown'
  isProvisional: boolean
}
export interface CreateProductInput extends ProductFields {
  id: string
  initialStock: number
  initialCost?: number
}
export interface MovementInput {
  id: string
  productId: string
  type: 'restock' | 'adjustment' | 'count'
  quantity: number
  reason?: string
  unitCost?: number
  expectedRevision: number
}
export interface CatalogSnapshot { products: CatalogProduct[]; categories: CatalogCategory[] }

export type ClassificationKind = 'categories' | 'families' | 'ips'
export interface CatalogClassification {
  id: string
  name: string
  description?: string
  order: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  normalizedName?: string
}
export interface ClassificationSnapshot { categories: CatalogCategory[]; families: CatalogClassification[]; ips: CatalogClassification[] }
