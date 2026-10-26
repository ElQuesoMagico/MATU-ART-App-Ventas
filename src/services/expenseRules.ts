import type { Expense, ExpenseFields, ExpenseCategory } from '../types/expenses.ts'
import type { Metrics } from './analytics.ts'
import { CatalogError, integer, validId } from './catalogValidation.ts'

export const defaultExpenseCategories: ExpenseCategory[] = ['Inscripción', 'Transporte', 'Alojamiento', 'Alimentación', 'Materiales', 'Publicidad', 'Otros'].map((name, index) => ({
  id: `00000000-0000-4000-9000-00000000000${index + 1}`, name, normalizedName: name.toLocaleLowerCase('es-CL'), createdAt: '2026-10-14T00:00:00.000Z',
}))
export function expenseFieldErrors(fields: ExpenseFields): Partial<Record<keyof ExpenseFields, string>> {
  const errors: Partial<Record<keyof ExpenseFields, string>> = {}
  if (!fields.concept.trim() || fields.concept.trim().length > 120) errors.concept = 'Escribe un concepto de hasta 120 caracteres.'
  if (!Number.isSafeInteger(fields.amount) || fields.amount <= 0 || fields.amount > 1_000_000_000) errors.amount = 'Ingresa un entero mayor que cero, hasta 1.000.000.000 CLP.'
  if (!fields.categoryId) errors.categoryId = 'Selecciona una categoría.'
  const parsed = new Date(`${fields.date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fields.date) errors.date = 'Indica una fecha válida.'
  if ((fields.notes?.length ?? 0) > 2000) errors.notes = 'Las notas admiten hasta 2.000 caracteres.'
  return errors
}
export function validateExpense(fields: ExpenseFields): ExpenseFields {
  const errors = expenseFieldErrors(fields)
  if (Object.keys(errors).length) throw new CatalogError(Object.values(errors)[0])
  validId(fields.categoryId); if (fields.eventId) validId(fields.eventId)
  integer(fields.amount, 'Importe')
  return { concept: fields.concept.trim(), amount: fields.amount, categoryId: fields.categoryId, date: fields.date, eventId: fields.eventId || undefined, notes: fields.notes?.trim() || undefined }
}
export function filterExpenses(expenses: readonly Expense[], filter: { eventId?: string; start?: string; end?: string }) {
  return expenses.filter(expense => expense.status === 'active' && (!filter.eventId || (filter.eventId === 'none' ? !expense.eventId : expense.eventId === filter.eventId)) && (!filter.start || expense.date >= filter.start) && (!filter.end || expense.date <= filter.end))
}
export interface FinancialMetrics { expenses: bigint; netProfit?: bigint; netMargin?: number }
/** Expenses never alter sale snapshots; unknown costs disable both profit and margin. */
export function financialMetrics(metrics: Metrics, expenses: readonly Expense[]): FinancialMetrics {
  const total = expenses.filter(expense => expense.status === 'active').reduce((sum, expense) => sum + BigInt(expense.amount), 0n)
  const netProfit = metrics.grossProfit === undefined ? undefined : metrics.grossProfit - total
  // Signed half-up percentage, two decimal places. No margin when revenue is zero.
  const absolute = netProfit !== undefined && netProfit < 0n ? -netProfit : netProfit
  const rounded = absolute !== undefined && metrics.revenue > 0n ? (absolute * 20_000n + metrics.revenue) / (2n * metrics.revenue) : undefined
  const netMargin = rounded === undefined ? undefined : Number(rounded) / 100 * (netProfit! < 0n ? -1 : 1)
  return { expenses: total, netProfit, netMargin }
}
