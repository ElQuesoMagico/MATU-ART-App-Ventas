import { CatalogError } from './catalogValidation.ts'
import type { ManualDiscount, AppliedDiscount } from '../types/discounts.ts'
export interface PricingLine { productId: string; quantity: number; unitPrice: number; discount?: ManualDiscount }
function moneyInteger(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new CatalogError('El importe debe ser un entero válido en CLP.') }
function safeNumber(value: bigint) { if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new CatalogError('El importe supera el máximo permitido.'); return Number(value) }
export function applyManualDiscount(baseAmount: number, discount?: ManualDiscount): AppliedDiscount | undefined {
  moneyInteger(baseAmount)
  if (!discount) return undefined
  if (!['percentage', 'fixed'].includes(discount.type) || !Number.isFinite(discount.value) || discount.value < 0) throw new CatalogError('Ingresa un descuento válido, mayor o igual a cero.')
  let amount: number
  if (discount.type === 'percentage') {
    if (discount.value > 100 || !/^\d+(\.\d{1,2})?$/.test(String(discount.value))) throw new CatalogError('El porcentaje debe estar entre 0 y 100, con hasta dos decimales.')
    const [whole, fraction = ''] = String(discount.value).split('.')
    const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
    // Por cada descuento: peso más cercano, mitades hacia arriba; cálculo entero.
    amount = Number((BigInt(baseAmount) * basisPoints + 5000n) / 10000n)
  } else { moneyInteger(discount.value); amount = discount.value }
  if (amount > baseAmount) throw new CatalogError('El descuento fijo no puede superar el importe disponible.')
  return { type: discount.type, value: discount.value, source: 'manual', baseAmount, amount }
}
export function calculateSalePricing(lines: PricingLine[], generalDiscount?: ManualDiscount) {
  const pricedLines = lines.map(line => {
    moneyInteger(line.unitPrice); moneyInteger(line.quantity)
    if (!line.quantity) throw new CatalogError('La cantidad debe ser mayor que cero.')
    const originalAmount = safeNumber(BigInt(line.unitPrice) * BigInt(line.quantity))
    const appliedDiscount = applyManualDiscount(originalAmount, line.discount)
    return { productId: line.productId, originalAmount, appliedDiscount, netAmount: originalAmount - (appliedDiscount?.amount ?? 0) }
  })
  const subtotal = safeNumber(pricedLines.reduce((sum, line) => sum + BigInt(line.originalAmount), 0n))
  const remainingSubtotal = safeNumber(pricedLines.reduce((sum, line) => sum + BigInt(line.netAmount), 0n))
  const appliedGeneralDiscount = applyManualDiscount(remainingSubtotal, generalDiscount)
  const total = remainingSubtotal - (appliedGeneralDiscount?.amount ?? 0)
  return { lines: pricedLines, subtotal, remainingSubtotal, appliedGeneralDiscount, discount: subtotal - total, total }
}
