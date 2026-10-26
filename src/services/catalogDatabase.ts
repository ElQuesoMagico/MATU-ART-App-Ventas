import type { Expense, ExpenseCategory, ExpenseChange } from '../types/expenses.ts'
import { defaultExpenseCategories } from './expenseRules.ts'
import type { Promotion } from '../types/promotions.ts'
import type { CatalogEvent } from '../types/events.ts'
import { normalizedName } from './catalogValidation.ts'
import { openDB, type DBSchema } from 'idb'
import type { CatalogClassification, CatalogCategory, CatalogProduct, EstimatedCostChange, InventoryMovement } from '../types/catalog.ts'
import type { RealSalesEvent, StoredPayment, StoredSale } from '../types/sales.ts'
export const CATALOG_DB_NAME = 'clown-ufo-catalog'
export const CATALOG_DB_VERSION = 10
export interface CatalogSchema extends DBSchema {
  importRecords: { key:string; value:import('../types/imports').ImportRecord; indexes:{'by-source':string} }
  expenses: { key: string; value: Expense; indexes: { 'by-event': string; 'by-date': string } }
  expenseCategories: { key: string; value: ExpenseCategory; indexes: { 'by-name': string } }
  expenseChanges: { key: string; value: ExpenseChange; indexes: { 'by-expense': string } }
  managedEvents: { key: string; value: CatalogEvent; indexes: { 'active-event': string } }
  promotions: { key: string; value: Promotion }
  families: { key: string; value: CatalogClassification; indexes: { 'by-name': string } }
  ips: { key: string; value: CatalogClassification; indexes: { 'by-name': string } }
  products: { key: string; value: CatalogProduct; indexes: { 'active-name': string } }
  categories: { key: string; value: CatalogCategory; indexes: { 'active-name': string; 'by-name': string } }
  movements: { key: string; value: InventoryMovement; indexes: { 'by-product': string } }
  costChanges: { key: string; value: EstimatedCostChange; indexes: { 'by-product': string } }
  sales: { key: string; value: StoredSale; indexes: { 'by-operation': string; 'by-number': number; 'by-date': string } }
  payments: { key: string; value: StoredPayment; indexes: { 'by-sale': string } }
  metadata: { key: string; value: { key: string; value: number } }
  events: { key: string; value: RealSalesEvent }
}
export function openCatalogDatabase(name = CATALOG_DB_NAME) {
  return openDB<CatalogSchema>(name, CATALOG_DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      void tx.done.catch(() => {}) // El aborto se informa por la promesa de apertura.
      let dataMigration: Promise<void> = Promise.resolve()
      // Migraciones acumulativas: cada futura versión añade su bloque oldVersion < N.
      if (oldVersion < 1) {
        db.createObjectStore('products', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
        db.createObjectStore('categories', { keyPath: 'id' }).createIndex('active-name', 'activeName', { unique: true })
        db.createObjectStore('movements', { keyPath: 'id' }).createIndex('by-product', 'productId')
      }
      if (oldVersion < 2) {
        // No inferir costo estimado a partir de costos históricos ni reescribir productos.
        db.createObjectStore('costChanges', { keyPath: 'id' }).createIndex('by-product', 'productId')
      }
      if (oldVersion < 3) {
        const sales = db.createObjectStore('sales', { keyPath: 'id' })
        sales.createIndex('by-operation', 'operationId', { unique: true })
        sales.createIndex('by-number', 'number', { unique: true })
        sales.createIndex('by-date', 'soldAt')
        db.createObjectStore('payments', { keyPath: 'id' }).createIndex('by-sale', 'saleId')
        db.createObjectStore('metadata', { keyPath: 'key' })
        // Registro real vacío: jamás copiar eventos de demostración.
        db.createObjectStore('events', { keyPath: 'id' })
      }
      if (oldVersion < 4) {
        db.createObjectStore('families', { keyPath: 'id' }).createIndex('by-name', 'normalizedName')
        db.createObjectStore('ips', { keyPath: 'id' }).createIndex('by-name', 'normalizedName')
        // Una sola transacción versionchange. Conservar categorías como respaldo.
        dataMigration = (async () => {
          const categories = await tx.objectStore('categories').getAll()
          for (const category of categories) await tx.objectStore('families').put({ id: category.id, name: category.name, order: category.order, isActive: category.isActive, createdAt: category.createdAt, updatedAt: category.updatedAt, normalizedName: normalizedName(category.name) })
          let cursor = await tx.objectStore('products').openCursor()
          while (cursor) {
            const product = cursor.value
            await cursor.update({ ...product, familyIds: [...new Set([...(product.familyIds ?? []), ...product.categoryIds])], ipIds: product.ipIds ?? [] })
            cursor = await cursor.continue()
          }
        })()
      }
      if (oldVersion < 5) {
        tx.objectStore('categories').createIndex('by-name', 'normalizedName')
        dataMigration = dataMigration.then(async () => {
          const categories = await tx.objectStore('categories').getAll()
          const categoryIds = new Set(categories.map(category => category.id))
          for (const category of categories) await tx.objectStore('categories').put({ ...category, normalizedName: normalizedName(category.name) })
          let cursor = await tx.objectStore('products').openCursor()
          while (cursor) {
            const product = cursor.value
            // Identidad histórica verificable por UUID; jamás por coincidencia de nombre.
            const candidates = [...new Set([...product.categoryIds, ...(product.familyIds ?? [])])].filter(id => categoryIds.has(id))
            const categoryId = product.categoryId && categoryIds.has(product.categoryId) ? product.categoryId : candidates.length === 1 ? candidates[0] : undefined
            await cursor.update({ ...product, categoryId, classificationPending: !categoryId })
            cursor = await cursor.continue()
          }
        })
      }
      if (oldVersion < 6) db.createObjectStore('promotions', { keyPath: 'id' })
      if (oldVersion < 7 && db.objectStoreNames.contains('metadata')) dataMigration = dataMigration.then(async () => {
        await tx.objectStore('metadata').put({ key: 'combos-packs-v1', value: 1 })
      })
      // No convertir eventos mínimos/fixtures anteriores en eventos reales.
      if (oldVersion < 8) db.createObjectStore('managedEvents', { keyPath: 'id' }).createIndex('active-event', 'activeKey', { unique: true })
      if (oldVersion < 9) {
        const expenses = db.createObjectStore('expenses', { keyPath: 'id' })
        expenses.createIndex('by-event', 'eventId'); expenses.createIndex('by-date', 'date')
        db.createObjectStore('expenseChanges', { keyPath: 'id' }).createIndex('by-expense', 'expenseId')
        db.createObjectStore('expenseCategories', { keyPath: 'id' }).createIndex('by-name', 'normalizedName', { unique: true })
        dataMigration = dataMigration.then(async () => { for (const category of defaultExpenseCategories) await tx.objectStore('expenseCategories').add(category) })
      }
      if (oldVersion < 10) db.createObjectStore('importRecords',{keyPath:'id'}).createIndex('by-source','sourceKey',{unique:true})
      void dataMigration.catch(() => { tx.abort() })
    },
    blocked() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('catalog-blocked')) },
    blocking(_current, _next, event) { (event.target as IDBDatabase).close() },
  })
}
