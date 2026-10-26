import type { PaymentInput, PaymentMethod } from '../types/sales.ts'
export const paymentMethods: PaymentMethod[] = ['cash', 'transfer', 'debit']
export type PaymentAmounts = Record<PaymentMethod, string>
export function initialPaymentAmounts(total: number): PaymentAmounts {
  return { cash: String(total), transfer: '0', debit: '0' }
}
export function evaluatePaymentAmounts(amounts: PaymentAmounts, total: number) {
  const validAmounts = paymentMethods.every(method => {
    const raw = amounts[method].trim()
    return (raw === '' || /^\d+$/.test(raw)) && Number.isSafeInteger(Number(raw)) && Number(raw) >= 0
  })
  const payments: PaymentInput[] = validAmounts ? paymentMethods.map(method => ({ method, amount: Number(amounts[method].trim()) })).filter(payment => payment.amount > 0) : []
  const paid = payments.reduce((sum, payment) => sum + BigInt(payment.amount), 0n)
  const validTotal = Number.isSafeInteger(total) && total >= 0
  const difference = validTotal ? BigInt(total) - paid : 0n
  return { payments, paid, difference, validAmounts, valid: validAmounts && validTotal && difference === 0n }
}
