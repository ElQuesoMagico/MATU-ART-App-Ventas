import type { Promotion } from '../types/promotions.ts'
import type { CatalogClassification, CatalogProduct } from '../types/catalog.ts'
import type { CatalogEvent } from '../types/events.ts'
export interface PromotionLabels { products: CatalogProduct[]; categories: CatalogClassification[]; families: CatalogClassification[]; ips: CatalogClassification[]; events: CatalogEvent[] }
export const promotionStatus = (p: Promotion) => p.isArchived ? 'Archivada' : p.isActive ? 'Activa' : 'Inactiva'
export function promotionAudience(p: Promotion, labels: PromotionLabels) {
  const names = (ids: string[], items: {id:string;name:string}[]) => ids.map(id => items.find(item => item.id === id)?.name ?? 'No disponible').join(', ')
  if (p.type === 'combo') return (p.components ?? []).map(c => `${c.quantity} × ${names([c.targetId], c.kind === 'product' ? labels.products : labels.categories)}`)
  return ([['Productos',p.productIds,labels.products],['Categorías',p.categoryIds,labels.categories],['Familias',p.familyIds,labels.families],['IPs',p.ipIds,labels.ips]] as const).filter(([,ids]) => ids.length).map(([label,ids,items]) => `${label}: ${names(ids,items)}`)
}
export const promotionEvents = (p: Promotion, events: CatalogEvent[]) => (p.eventIds ?? []).map(id => events.find(e => e.id === id)?.name ?? 'Evento no disponible').join(', ')
