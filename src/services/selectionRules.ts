import type { CatalogClassification } from '../types/catalog.ts'
export function toggleClassification(ids: string[], id: string, single = false) {
  return single ? [id] : ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]
}
export const sameClassificationSelection = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id))
export function classificationOptions(items: CatalogClassification[], selected: string[], query: string, assign: boolean) {
  return items.filter(item => (!assign || item.isActive || selected.includes(item.id)) && item.name.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))
}
