import { calculateComboPricing } from './comboRules.ts'
import { chileDay, validatePromotion, promotionMatches, promotionEventMatches, promotionGroups, groupMatches, MAX_ACTIVE_PROMOTIONS } from './promotionConditions.ts'
import { CatalogError } from './catalogValidation.ts'
import { applyManualDiscount, calculateSalePricing, type PricingLine } from './discountRules.ts'
import type { ManualDiscount } from '../types/discounts.ts'
import type { Promotion, AppliedPromotion, AppliedCombo } from '../types/promotions.ts'
export interface PromotionLine extends PricingLine { hasEventPrice?: boolean; categoryId?: string; familyIds?: string[]; ipIds?: string[] }
const compareIds = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1
export { validatePromotion, MAX_ACTIVE_PROMOTIONS } from './promotionConditions.ts'
function distribute(amount: number, eligible: number[], balances: number[], lines: PromotionLine[]) {
  const base = eligible.reduce((sum, index) => sum + BigInt(balances[index]), 0n)
  const allocations = eligible.map(index => ({ index, amount: Number(BigInt(amount) * BigInt(balances[index]) / base), remainder: BigInt(amount) * BigInt(balances[index]) % base }))
  let remainder = amount - allocations.reduce((sum, row) => sum + row.amount, 0)
  allocations.sort((a, b) => a.remainder === b.remainder ? compareIds(lines[a.index].productId, lines[b.index].productId) : a.remainder > b.remainder ? -1 : 1)
  for (const row of allocations) if (remainder > 0) { row.amount++; remainder-- }
  return allocations
}
function calculateTraditionalPricing(lines: PromotionLine[], promotions: Promotion[], generalDiscount: ManualDiscount | undefined, now: string) {
  const manual = calculateSalePricing(lines)
  const day = chileDay(now)
  const active = promotions.filter(p => p.isActive && !p.isArchived)
  if (active.length > MAX_ACTIVE_PROMOTIONS) throw new CatalogError('Hay más de 12 promociones activas. Desactiva algunas antes de cobrar.')
  if (new Set(lines.map(line => line.productId)).size !== lines.length || new Set(promotions.map(p => p.id)).size !== promotions.length) throw new CatalogError('Identificadores repetidos en el cálculo.')
  const candidates = active.filter(p => (!p.startDate || p.startDate <= day) && (!p.endDate || p.endDate >= day)).map(p => {
    validatePromotion(p)
    const eligible = lines.flatMap((line, index) => promotionMatches(line, p) ? [index] : [])
    const quantity = eligible.reduce((sum, index) => sum + BigInt(lines[index].quantity), 0n)
    const amount = eligible.reduce((sum, index) => sum + BigInt(manual.lines[index].originalAmount), 0n)
    return { promotion: p, eligible, qualifies: eligible.length > 0 && quantity >= BigInt(p.minimumQuantity) && amount >= BigInt(p.minimumAmount) }
  }).filter(p => p.qualifies).sort((a,b) => compareIds(a.promotion.id, b.promotion.id))
  const compatible = (a: typeof candidates[number], b: typeof candidates[number]) => (a.promotion.isStackable && b.promotion.isStackable) || !a.eligible.some(index => b.eligible.includes(index))
  let best: { balances: number[]; applied: AppliedPromotion[]; general: ReturnType<typeof applyManualDiscount>; total: number; key: string } | undefined
  function evaluate(selected: number[]) {
    const balances = manual.lines.map(line => line.netAmount)
    const applied: AppliedPromotion[] = []
    for (const index of selected) {
      const { promotion, eligible } = candidates[index]
      const base = eligible.reduce((sum, index) => sum + balances[index], 0)
      if (!base) continue
      const amount = applyManualDiscount(base, promotion.type === 'fixed' ? { type: 'fixed', value: Math.min(base, promotion.value) } : { type: promotion.type === 'percentage' ? 'percentage' : 'fixed', value: promotion.value })!.amount
      if (!amount) continue
      const allocations = distribute(amount, eligible, balances, lines)
      for (const row of allocations) balances[row.index] -= row.amount
      applied.push({ id: promotion.id, name: promotion.name, type: promotion.type, value: promotion.value, amount, configuration: promotion, products: allocations.filter(row => row.amount > 0).sort((a,b) => compareIds(lines[a.index].productId, lines[b.index].productId)).map(row => ({ productId: lines[row.index].productId, quantity: lines[row.index].quantity, amount: row.amount })) })
    }
    const remaining = balances.reduce((sum, amount) => sum + amount, 0)
    let general: ReturnType<typeof applyManualDiscount>
    try { general = applyManualDiscount(remaining, generalDiscount) } catch { return }
    const total = remaining - (general?.amount ?? 0)
    const key = applied.map(p => p.id).join('|')
    if (!best || total < best.total || (total === best.total && (applied.length < best.applied.length || (applied.length === best.applied.length && key < best.key)))) best = { balances, applied, general, total, key }
  }
  function search(index: number, selected: number[]) {
    if (index === candidates.length) { evaluate(selected); return }
    search(index+1, selected)
    if (selected.every(other => compatible(candidates[index], candidates[other]))) search(index+1, [...selected, index])
  }
  search(0, [])
  if (!best) { applyManualDiscount(manual.remainingSubtotal, generalDiscount); throw new CatalogError('No hay una combinación válida.') }
  const chosen = best as NonNullable<typeof best>
  const pricedLines = manual.lines.map((line, index) => ({ ...line, netAmount: chosen.balances[index], promotionDiscount: line.netAmount - chosen.balances[index] }))
  return { lines: pricedLines, subtotal: manual.subtotal, remainingSubtotal: chosen.balances.reduce((a,b) => a+b,0), appliedGeneralDiscount: chosen.general, promotions: structuredClone(chosen.applied), combos: [] as AppliedCombo[], automaticDiscount: chosen.applied.reduce((sum,p) => sum+p.amount,0), discount: manual.subtotal - chosen.total, total: chosen.total }
}
export function calculatePromotionPricing(lines: PromotionLine[], promotions: Promotion[], generalDiscount: ManualDiscount | undefined, now: string, eventId?: string) {
  const day = chileDay(now)
  const active = promotions.filter(p=>p.isActive&&!p.isArchived)
  if(active.length>MAX_ACTIVE_PROMOTIONS) throw new CatalogError('Máximo 12 promociones activas, incluidos combos.')
  if(new Set(promotions.map(p=>p.id)).size!==promotions.length) throw new CatalogError('Identificadores repetidos.')
  active.forEach(validatePromotion)
  promotions = promotions.filter(p => promotionEventMatches(p, eventId))
  const combos = promotions.filter(p => (p.type === 'combo' || p.type === 'quantity') && p.isActive && !p.isArchived && (!p.startDate || p.startDate <= day) && (!p.endDate || p.endDate >= day))
  const possible = combos.some(p => promotionGroups(p).every(c => lines.filter(line => groupMatches(line, c, p)).reduce((sum,line)=>sum+line.quantity,0) >= c.quantity))
  if (possible) return calculateComboPricing(lines, promotions, generalDiscount, now)
  return calculateTraditionalPricing(lines, promotions.filter(p=>p.type !== 'combo' && p.type !== 'quantity'), generalDiscount, now)
}
export const promotionPricingSignature = (pricing: ReturnType<typeof calculatePromotionPricing>) => JSON.stringify({ subtotal: pricing.subtotal, total: pricing.total, lines: pricing.lines, promotions: pricing.promotions, general: pricing.appliedGeneralDiscount, combos: pricing.combos.length ? pricing.combos : undefined })
