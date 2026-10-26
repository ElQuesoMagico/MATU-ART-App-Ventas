import type { CatalogProduct, ProductFields } from '../types/catalog.ts'
export class CatalogError extends Error {}
export const normalizedName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-CL')
export function validName(name: string) {
  if (!name.trim() || name.trim().length > 120) throw new CatalogError('El nombre es obligatorio y debe tener hasta 120 caracteres.')
}
export function integer(value: number, label: string, allowNegative = false) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000 || (!allowNegative && value < 0)) throw new CatalogError(`${label}: ingresa un entero ${allowNegative ? 'válido' : 'mayor o igual a cero'} (máximo 1.000.000.000).`)
}
export function validId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new CatalogError('Identificador de operación inválido.')
}
export function validateFields(input: ProductFields) {
  if (input.eventPrices !== undefined) {
    if (!Array.isArray(input.eventPrices) || new Set(input.eventPrices.map(item => item.eventId)).size !== input.eventPrices.length) throw new CatalogError('Cada producto puede tener un solo precio por evento.')
    for (const item of input.eventPrices) { validId(item.eventId); integer(item.price, 'Precio por evento') }
  }
  if(input.kind !== undefined && !['product','pack'].includes(input.kind)) throw new CatalogError('Tipo de producto inválido.')
  if(input.packContents !== undefined) {
    if(!Array.isArray(input.packContents) || new Set(input.packContents.map(c=>c.productId)).size!==input.packContents.length || (input.kind !== 'pack' && input.packContents.length)) throw new CatalogError('Contenido de pack inválido.')
    for(const content of input.packContents) { validId(content.productId); integer(content.quantity,'Cantidad del contenido'); if(!content.quantity) throw new CatalogError('El contenido debe tener cantidades positivas.') }
  }
  validName(input.name); integer(input.price, 'Precio'); integer(input.lowStockThreshold, 'Umbral')
  if (input.estimatedUnitCost !== undefined) integer(input.estimatedUnitCost, 'Costo estimado')
  if ((input.description?.length ?? 0) > 2000) throw new CatalogError('La descripción admite hasta 2.000 caracteres.')
  if (typeof input.isFavorite !== 'boolean') throw new CatalogError('Estado de destacado inválido.')
  if (!Array.isArray(input.categoryIds) || new Set(input.categoryIds).size !== input.categoryIds.length) throw new CatalogError('Selección de categorías inválida.')
  input.categoryIds.forEach(validId)
  if (input.categoryId) validId(input.categoryId)
  for (const ids of [input.familyIds, input.ipIds]) {
    if (ids !== undefined) {
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new CatalogError('Selección de familias o IPs inválida.')
      ids.forEach(validId)
    }
  }
  if (input.image && (!(input.image instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(input.image.type) || input.image.size > 5 * 1024 * 1024)) throw new CatalogError('La imagen debe ser PNG, JPEG o WebP, de hasta 5 MB.')
}
/** Redondeo CLP con aritmética entera, sin confundir costo 0 con desconocido. */
export function restockCost(product: CatalogProduct, units: number, unitCost?: number) {
  const resultingStock = product.stock + units
  if (unitCost === undefined) return { averageCost: product.averageCost, lastKnownCost: product.lastKnownCost, averageCostIsProvisional: true }
  if (product.stock <= 0) return { averageCost: unitCost, lastKnownCost: unitCost, averageCostIsProvisional: product.stock < 0 || resultingStock <= 0 }
  if (product.averageCost === undefined) return { averageCost: unitCost, lastKnownCost: unitCost, averageCostIsProvisional: true }
  const total = BigInt(product.stock) * BigInt(product.averageCost) + BigInt(units) * BigInt(unitCost)
  const divisor = BigInt(resultingStock)
  return { averageCost: Number((total + divisor / 2n) / divisor), lastKnownCost: unitCost, averageCostIsProvisional: product.averageCostIsProvisional }
}
export function storageError(error: unknown): string {
  if (error instanceof CatalogError) return error.message
  const name = error instanceof Error ? error.name : ''
  if (name === 'ConstraintError') return 'Ya existe un producto o clasificación con ese nombre.'
  if (name === 'QuotaExceededError') return 'No queda espacio en este dispositivo. Libera espacio y vuelve a intentar; no se guardaron cambios parciales.'
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotAllowedError') return 'El navegador no permite acceder al almacenamiento local. Revisa sus permisos o el modo privado.'
  if (name === 'VersionError') return 'La base local pertenece a una versión más reciente. Abre la versión actual de MATU ART.'
  return 'No se pudo completar la operación en el almacenamiento local. Intenta de nuevo.'
}
