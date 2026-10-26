import { money } from './format'
export const discountLabel = (discount: { type: 'percentage' | 'fixed' | 'combo' | 'quantity'; value: number }) => discount.type === 'percentage' ? `${discount.value} %` : discount.type === 'quantity' ? `Grupo ${money(discount.value)}` : discount.type === 'combo' ? `Combo ${money(discount.value)}` : money(discount.value)
