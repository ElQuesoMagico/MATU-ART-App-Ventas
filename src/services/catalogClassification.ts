import type { CatalogProduct, CatalogClassification } from '../types/catalog.ts'
export const productFamilyIds = (product: CatalogProduct) => product.familyIds ?? []
export function matchesClassifications(product: CatalogProduct, familyIds: string[], ipIds: string[], categoryIds: string[] = []) {
  return (!categoryIds.length || (!!product.categoryId && categoryIds.includes(product.categoryId))) && (!familyIds.length || familyIds.some(id => productFamilyIds(product).includes(id))) && (!ipIds.length || ipIds.some(id => (product.ipIds ?? []).includes(id)))
}
export function classificationNames(ids: string[], items: CatalogClassification[]) {
  return ids.map(id => { const item = items.find(item => item.id === id); return item ? `${item.name}${item.isActive ? '' : ' (archivada)'}` : 'Clasificación no disponible' }).join(' · ')
}
