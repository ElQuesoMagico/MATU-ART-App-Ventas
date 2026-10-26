import type { IDBPTransaction } from 'idb'
import { openCatalogDatabase, type CatalogSchema } from './catalogDatabase.ts'
import { CatalogError, normalizedName, validId, validName } from './catalogValidation.ts'
import { validateExpense } from './expenseRules.ts'
import type { Expense, ExpenseFields, ExpenseChange } from '../types/expenses.ts'

type Transaction = IDBPTransaction<CatalogSchema, ['expenses', 'expenseChanges', 'expenseCategories', 'managedEvents'], 'readwrite'>
export class ExpenseRepository {
  private readonly databaseName?: string
  constructor(databaseName?: string) { this.databaseName = databaseName }
  async snapshot() {
    const db = await openCatalogDatabase(this.databaseName)
    try {
      const tx = db.transaction(['expenses', 'expenseCategories'])
      const [expenses, expenseCategories] = await Promise.all([tx.objectStore('expenses').getAll(), tx.objectStore('expenseCategories').getAll()]); await tx.done
      return { expenses: expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)), expenseCategories: expenseCategories.sort((a, b) => a.name.localeCompare(b.name, 'es')) }
    } finally { db.close() }
  }
  private async write<T>(operation: (tx: Transaction) => Promise<T>) {
    const db = await openCatalogDatabase(this.databaseName)
    const tx = db.transaction(['expenses', 'expenseChanges', 'expenseCategories', 'managedEvents'], 'readwrite')
    void tx.done.catch(() => {})
    try { const result = await operation(tx); await tx.done; return result }
    catch (error) { try { tx.abort() } catch { /* Already completed. */ } await tx.done.catch(() => {}); throw error }
    finally { db.close() }
  }
  async save(input: { id: string; operationId: string; fields: ExpenseFields; expectedRevision?: number }) {
    validId(input.id); validId(input.operationId)
    const clean = validateExpense(input.fields)
    const fingerprint = JSON.stringify({ action: 'save', id: input.id, fields: clean, revision: input.expectedRevision })
    return this.write(async tx => {
      const retry = await tx.objectStore('expenseChanges').get(input.operationId)
      if (retry) { if (retry.fingerprint !== fingerprint) throw new CatalogError('El identificador corresponde a otra operación.'); return retry.after }
      const previous = await tx.objectStore('expenses').get(input.id)
      if (previous ? previous.revision !== input.expectedRevision : input.expectedRevision !== undefined) throw new CatalogError('El gasto cambió en otra pestaña. Cierra el formulario y vuelve a abrirlo.')
      if (previous?.status === 'voided') throw new CatalogError('Un gasto anulado no se puede modificar.')
      if (!await tx.objectStore('expenseCategories').get(clean.categoryId)) throw new CatalogError('La categoría de gasto no está disponible.')
      if (clean.eventId && !await tx.objectStore('managedEvents').get(clean.eventId)) throw new CatalogError('El evento seleccionado no está disponible.')
      const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
      const saved: Expense = { ...clean, id: input.id, status: 'active', revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now }
      await tx.objectStore('expenses').put(saved)
      await tx.objectStore('expenseChanges').add({ id: input.operationId, expenseId: input.id, type: previous ? 'edit' : 'create', before: previous, after: saved, createdAt: now, fingerprint })
      return saved
    })
  }
  async void(input: { id: string; operationId: string; expectedRevision: number; reason: string }) {
    validId(input.id); validId(input.operationId)
    const reason = input.reason.trim()
    if (!reason || reason.length > 500) throw new CatalogError('Indica un motivo de hasta 500 caracteres.')
    const fingerprint = JSON.stringify({ action: 'void', id: input.id, revision: input.expectedRevision, reason })
    return this.write(async tx => {
      const retry = await tx.objectStore('expenseChanges').get(input.operationId)
      if (retry) { if (retry.fingerprint !== fingerprint) throw new CatalogError('El identificador corresponde a otra operación.'); return retry.after }
      const previous = await tx.objectStore('expenses').get(input.id)
      if (!previous || previous.status === 'voided') throw new CatalogError('El gasto no existe o ya fue anulado.')
      if (previous.revision !== input.expectedRevision) throw new CatalogError('El gasto cambió en otra pestaña. Revisa sus datos antes de anular.')
      const now = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString()
      const saved: Expense = { ...previous, status: 'voided', revision: previous.revision + 1, updatedAt: now }
      await tx.objectStore('expenses').put(saved)
      await tx.objectStore('expenseChanges').add({ id: input.operationId, expenseId: input.id, type: 'void', before: previous, after: saved, reason, createdAt: now, fingerprint })
      return saved
    })
  }
  async createCategory(id: string, name: string) {
    validId(id); validName(name)
    return this.write(async tx => {
      const store = tx.objectStore('expenseCategories'), key = normalizedName(name)
      const existing = await store.get(id)
      if (existing) { if (existing.normalizedName !== key) throw new CatalogError('El identificador corresponde a otra categoría.'); return existing }
      if (await store.index('by-name').get(key)) throw new CatalogError('Ya existe una categoría con ese nombre.')
      const category = { id, name: name.trim(), normalizedName: key, createdAt: new Date().toISOString() }
      await store.add(category); return category
    })
  }
  async history(id: string): Promise<ExpenseChange[]> {
    const db = await openCatalogDatabase(this.databaseName)
    try { return (await db.getAllFromIndex('expenseChanges', 'by-expense', id)).sort((a, b) => b.after.revision - a.after.revision) }
    finally { db.close() }
  }
}
export const expenseRepository = new ExpenseRepository()
