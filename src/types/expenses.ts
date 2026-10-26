export interface ExpenseFields {
  concept: string
  amount: number
  categoryId: string
  date: string
  eventId?: string
  notes?: string
}
export interface Expense extends ExpenseFields {
  id: string
  createdAt: string
  updatedAt: string
  revision: number
  status: 'active' | 'voided'
}
export interface ExpenseCategory { id: string; name: string; normalizedName: string; createdAt: string }
export interface ExpenseChange {
  id: string
  expenseId: string
  type: 'create' | 'edit' | 'void'
  createdAt: string
  before?: Expense
  after: Expense
  reason?: string
  fingerprint: string
}
export interface ExpenseSnapshot { expenses: Expense[]; expenseCategories: ExpenseCategory[] }
