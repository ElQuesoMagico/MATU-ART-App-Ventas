import { CatalogError, validId, validName } from './catalogValidation.ts'
import { applyManualDiscount } from './discountRules.ts'
import type { Promotion, ComboComponent } from '../types/promotions.ts'
import type { PromotionLine } from './promotionRules.ts'
export const MAX_ACTIVE_PROMOTIONS = 12
export const MAX_COMBO_COMPONENTS = 4
export const MAX_COMBO_UNITS = 8

export function chileDay(now: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const value = (type: string) => parts.find(part => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
export function validatePromotion(promotion: Promotion) {
  validId(promotion.id); validName(promotion.name)
  if ((promotion.description?.length ?? 0) > 2000) throw new CatalogError('La descripción admite hasta 2.000 caracteres.')
  for (const ids of [promotion.productIds, promotion.categoryIds, promotion.familyIds, promotion.ipIds, promotion.eventIds ?? []]) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new CatalogError('Destinatarios inválidos.')
    ids.forEach(validId)
  }
  for (const n of [promotion.minimumQuantity, promotion.minimumAmount]) if (!Number.isSafeInteger(n) || n < 0) throw new CatalogError('Los mínimos deben ser enteros no negativos.')
  for (const flag of [promotion.isActive, promotion.isArchived, promotion.isStackable]) if (typeof flag !== 'boolean') throw new CatalogError('Estado de promoción inválido.')
  // Valida tipo/valor sin limitar un fijo por un importe de carrito particular.
  if (promotion.type === 'quantity') {
    if (!Number.isSafeInteger(promotion.groupQuantity) || promotion.groupQuantity! < 2 || promotion.groupQuantity! > MAX_COMBO_UNITS) throw new CatalogError('La oferta por cantidad admite entre 2 y 8 unidades por grupo.')
    if (!Number.isSafeInteger(promotion.value) || promotion.value < 0) throw new CatalogError('El precio del grupo debe ser un entero CLP no negativo.')
    if (promotion.components?.length) throw new CatalogError('La oferta por cantidad usa destinatarios, no componentes.')
  } else if (promotion.type === 'combo') {
    if (!Number.isSafeInteger(promotion.value) || promotion.value < 0) throw new CatalogError('El precio de combo debe ser un entero CLP no negativo.')
    if (!promotion.components?.length || promotion.components.length > MAX_COMBO_COMPONENTS) throw new CatalogError('Un combo admite entre 1 y 4 componentes.')
    if (new Set(promotion.components.map(c => c.id)).size !== promotion.components.length) throw new CatalogError('Componentes repetidos.')
    for (const component of promotion.components) {
      validId(component.id); validId(component.targetId)
      if (!['product','category'].includes(component.kind) || !Number.isSafeInteger(component.quantity) || component.quantity <= 0) throw new CatalogError('Cada componente requiere producto/categoría y una cantidad entera positiva.')
    }
    if (promotion.components.reduce((sum,c)=>sum+c.quantity,0) > MAX_COMBO_UNITS) throw new CatalogError('Un combo admite hasta 8 unidades por aplicación.')
    if (promotion.productIds.length || promotion.categoryIds.length || promotion.familyIds.length || promotion.ipIds.length || promotion.minimumQuantity || promotion.minimumAmount) throw new CatalogError('Los combos utilizan componentes; no filtros ni mínimos de descuento tradicional.')
  } else applyManualDiscount(Number.MAX_SAFE_INTEGER, { type: promotion.type, value: promotion.value })
  for (const date of [promotion.startDate, promotion.endDate]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new CatalogError('Fecha inválida.')
  if (promotion.startDate && promotion.endDate && promotion.startDate > promotion.endDate) throw new CatalogError('La fecha final debe ser igual o posterior al inicio.')
}
export function promotionMatches(line: PromotionLine, promotion: Promotion) {
  return (!(promotion.eventIds?.length && line.hasEventPrice)) && (!promotion.productIds.length || promotion.productIds.includes(line.productId)) && (!promotion.categoryIds.length || (!!line.categoryId && promotion.categoryIds.includes(line.categoryId))) && (!promotion.familyIds.length || promotion.familyIds.some(id => line.familyIds?.includes(id))) && (!promotion.ipIds.length || promotion.ipIds.some(id => line.ipIds?.includes(id)))
}

/** Legacy event prices take precedence over event-restricted promotions on those units. */
export const promotionEventMatches = (promotion: Promotion, eventId?: string) => !promotion.eventIds?.length || (!!eventId && promotion.eventIds.includes(eventId))
export function promotionGroups(p: Promotion): ComboComponent[] { return p.type === 'quantity' ? [{ id: p.id, kind: 'product', targetId: p.id, quantity: p.groupQuantity! }] : p.components ?? [] }
export const groupMatches = (line: PromotionLine, component: ComboComponent, p: Promotion) => !(p.eventIds?.length && line.hasEventPrice) && (p.type === 'quantity' ? promotionMatches(line, p) : component.kind === 'product' ? line.productId === component.targetId : line.categoryId === component.targetId)
