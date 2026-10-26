import { normalizedName } from './catalogValidation.ts'
import type { CatalogProduct } from '../types/catalog.ts'
export interface ProductFormValues { name: string; categoryId: string; price: string; cost: string; stock: string; threshold: string }
export function productFormErrors(values: ProductFormValues, products: CatalogProduct[], product?: CatalogProduct) {
  const errors: Partial<Record<keyof ProductFormValues | 'image', string>> = {}
  if (!values.name.trim()) errors.name = 'Ingresa un nombre.'
  else if (products.some(p => p.id !== product?.id && !p.isArchived && !product?.isArchived && normalizedName(p.name) === normalizedName(values.name))) errors.name = 'Ya existe un producto activo con este nombre.'
  if (!values.categoryId) errors.categoryId = 'Selecciona una categoría principal.'
  for (const field of ['price', 'cost', 'stock', 'threshold'] as const) {
    if (field === 'stock' && product || field === 'cost' && !values.cost.trim()) continue
    const raw = values[field].trim()
    if (!(field === 'stock' ? /^-?\d+$/ : /^\d+$/).test(raw) || Math.abs(Number(raw)) > 1_000_000_000) errors[field] = field === 'stock' ? 'Ingresa una cantidad entera válida.' : 'Ingresa un entero entre 0 y 1.000.000.000.'
  }
  return errors
}
/** The single creation cost initializes average, last known and estimated cost. */
export const initialProductCosts = (raw: string) => { const cost = raw.trim() === '' ? undefined : Number(raw); return { initialCost: cost, estimatedUnitCost: cost } }
