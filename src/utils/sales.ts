import type { PaymentMethod, StoredSaleItem } from '../types/sales'
import { money } from './format'
export const paymentLabels: Record<PaymentMethod, string> = { cash: 'Efectivo', transfer: 'Transferencia', debit: 'Débito' }
export const saleNumber = (number: number) => `V-${String(number).padStart(6, '0')}`
export function saleCostLabel(item: Pick<StoredSaleItem, 'cost'>) {
  const { cost } = item
  if (cost.unitCost === undefined) return 'Desconocido'
  const source = cost.source === 'estimated' ? 'Estimado' : cost.source === 'average' ? 'Promedio' : 'Último conocido'
  return `${money(cost.unitCost)} · ${source}${cost.isProvisional ? ' · Provisional' : ''}`
}
