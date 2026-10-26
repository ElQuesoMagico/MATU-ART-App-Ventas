import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { ExpenseRepository } from '../src/services/expenseRepository.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { defaultExpenseCategories, expenseFieldErrors, filterExpenses, financialMetrics } from '../src/services/expenseRules.ts'
import { buildAnalytics, financialDayStatistics } from '../src/services/analytics.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import type { Expense, ExpenseFields } from '../src/types/expenses.ts'
import type { StoredSale, StoredSaleItem } from '../src/types/sales.ts'
import type { CatalogEvent } from '../src/types/events.ts'

const id = () => crypto.randomUUID()
const fields = (patch: Partial<ExpenseFields> = {}): ExpenseFields => ({ concept: 'Transporte feria', amount: 5000, date: '2026-10-14', categoryId: defaultExpenseCategories[1].id, ...patch })
const expense = (patch: Partial<Expense> = {}): Expense => ({ ...fields(), id: id(), status: 'active', revision: 1, createdAt: '', updatedAt: '', ...patch })
const event = (patch: Partial<CatalogEvent> = {}): CatalogEvent => ({ id: id(), name: 'Feria', status: 'finished', startDate: '2026-10-14', endDate: '2026-10-16', createdAt: '', updatedAt: '', ...patch })
const line = (patch: Partial<StoredSaleItem> = {}): StoredSaleItem => ({ productId: id(), name: 'Nombre histórico', categoryIds: [], quantity: 2, unitPrice: 1000, lineTotal: 2000, cost: { unitCost: 100, source: 'average', condition: 'known', isProvisional: false }, stock: { quantitySold: 2, previousStock: 2, resultingStock: 0, quantityDeducted: 2, uncoveredQuantity: 0 }, ...patch })
const sale = (patch: Partial<StoredSale> = {}): StoredSale => ({ id: id(), operationId: id(), operationFingerprint: '', number: 1, soldAt: '2026-10-14T12:00:00Z', createdAt: '', status: 'completed', items: [line()], subtotal: 2000, total: 1800, discount: 200, stockDifferences: [], movementIds: [], payments: [], ...patch })
const setup = () => { const name = `expenses-${id()}`; return { name, repo: new ExpenseRepository(name) } }

test('gasto global: creación, edición, anulación y copias históricas persistentes', async () => {
  const { name, repo } = setup(), expenseId = id()
  const first = await repo.save({ id: expenseId, operationId: id(), fields: fields() })
  const edited = await repo.save({ id: expenseId, operationId: id(), expectedRevision: 1, fields: fields({ amount: 8000, notes: 'Peajes incluidos' }) })
  const voided = await repo.void({ id: expenseId, operationId: id(), expectedRevision: 2, reason: 'Ingreso duplicado' })
  assert.equal(voided.status, 'voided'); assert.equal(voided.id, first.id); assert.equal(voided.createdAt, first.createdAt)
  const reopened = new ExpenseRepository(name), history = await reopened.history(expenseId)
  assert.equal(history.length, 3); assert.deepEqual(history[0].before, edited); assert.deepEqual(history[1].before, first)
  assert.deepEqual(history[0].after, voided); assert.equal(history[0].reason, 'Ingreso duplicado')
  assert.deepEqual((await reopened.snapshot()).expenses, [voided])
  await assert.rejects(repo.save({ id: expenseId, operationId: id(), expectedRevision: 3, fields: fields() }), /anulado/)
})
test('evento opcional, válido y verificable; cambio de asociación queda auditado', async () => {
  const { name, repo } = setup(), events = new EventRepository(name)
  const feria = await events.save(id(), { name: 'Feria', startDate: '2026-10-14', endDate: '2026-10-16' })
  const input = { id: id(), operationId: id(), fields: fields({ eventId: feria.id }) }
  const saved = await repo.save(input); assert.equal(saved.eventId, feria.id)
  const global = await repo.save({ ...input, operationId: id(), expectedRevision: 1, fields: fields() })
  assert.equal(global.eventId, undefined); assert.equal((await repo.history(saved.id))[0].before?.eventId, feria.id)
  await assert.rejects(repo.save({ id: id(), operationId: id(), fields: fields({ eventId: id() }) }), /evento/)
})
test('validaciones: importes CLP, concepto, categoría, notas y fecha real', async () => {
  const { repo } = setup()
  for (const amount of [0, -1, 1.5, NaN, Infinity, 1_000_000_001]) await assert.rejects(repo.save({ id: id(), operationId: id(), fields: fields({ amount }) }))
  for (const patch of [{ concept: ' ' }, { concept: 'x'.repeat(121) }, { categoryId: id() }, { notes: 'x'.repeat(2001) }, { date: '2026-02-30' }, { date: '' }]) await assert.rejects(repo.save({ id: id(), operationId: id(), fields: fields(patch) }))
  assert(expenseFieldErrors(fields({ amount: NaN })).amount)
  assert.deepEqual((await repo.snapshot()).expenses, [])
})
test('doble clic/reintento y cambios concurrentes no duplican ni sobrescriben', async () => {
  const { name, repo } = setup(), other = new ExpenseRepository(name)
  const input = { id: id(), operationId: id(), fields: fields() }
  const [first, retry] = await Promise.all([repo.save(input), other.save(input)])
  assert.deepEqual(first, retry); assert.equal((await repo.history(first.id)).length, 1)
  await assert.rejects(other.save({ ...input, fields: fields({ amount: 9000 }) }), /otra operación/)
  await assert.rejects(other.save({ ...input, operationId: id() }), /cambió/)
  const results = await Promise.allSettled([repo.save({ ...input, operationId: id(), expectedRevision: 1, fields: fields({ amount: 6000 }) }), other.save({ ...input, operationId: id(), expectedRevision: 1, fields: fields({ amount: 7000 }) })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await repo.history(first.id)).length, 2)
  const voidInput = { id: first.id, operationId: id(), expectedRevision: 2, reason: 'Prueba' }
  assert.deepEqual(await repo.void(voidInput), await other.void(voidInput))
  await assert.rejects(other.void({ ...voidInput, operationId: id(), expectedRevision: 3 }), /anulado/)
  assert.equal((await repo.history(first.id)).length, 3)
})
test('categorías iniciales idempotentes y creación rápida con nombres únicos', async () => {
  const { name, repo } = setup()
  assert.equal((await repo.snapshot()).expenseCategories.length, 7)
  const category = await repo.createCategory(id(), 'Servicios')
  assert.deepEqual(await repo.createCategory(category.id, 'Servicios'), category)
  await assert.rejects(repo.createCategory(id(), '  SERVICIOS  '), /existe/)
  await repo.save({ id: id(), operationId: id(), fields: fields({ categoryId: category.id }) })
  assert.equal((await new ExpenseRepository(name).snapshot()).expenseCategories.length, 8)
})
test('fallo al escribir auditoría revierte creación, edición y anulación', async () => {
  const { repo } = setup(), saved = await repo.save({ id: id(), operationId: id(), fields: fields() })
  const add = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(value, key) { if (this.name === 'expenseChanges') throw new DOMException('Sin espacio', 'QuotaExceededError'); return add.call(this, value, key) }
  try {
    await assert.rejects(repo.save({ id: id(), operationId: id(), fields: fields() }), /Sin espacio/)
    await assert.rejects(repo.save({ id: saved.id, operationId: id(), expectedRevision: 1, fields: fields({ amount: 999 }) }), /Sin espacio/)
    await assert.rejects(repo.void({ id: saved.id, operationId: id(), expectedRevision: 1, reason: 'Prueba' }), /Sin espacio/)
  } finally { IDBObjectStore.prototype.add = add }
  assert.deepEqual((await repo.snapshot()).expenses, [saved]); assert.equal((await repo.history(saved.id)).length, 1)
})
test('comparación entre eventos: gastos globales no distribuidos, anulaciones excluidas', () => {
  const a = event(), b = event(), empty = event()
  const expenses = [expense({ amount: 300, eventId: a.id }), expense({ amount: 500, eventId: b.id }), expense({ amount: 900 }), expense({ amount: 50000, eventId: a.id, status: 'voided' })]
  const stats = buildAnalytics([sale({ event: a }), sale({ event: b, total: 1200 }), sale({ event: a, status: 'voided', total: 100000 })], [a, b, empty], expenses)
  const first = stats.events.find(row => row.id === a.id)!, second = stats.events.find(row => row.id === b.id)!
  assert.deepEqual(first.financial, { expenses: 300n, netProfit: 1300n, netMargin: 72.22 })
  assert.equal(second.financial.netProfit, 500n); assert.equal(first.metrics.units, 2); assert.equal(first.metrics.transactions, 1)
  assert.equal(financialMetrics(stats.metrics, filterExpenses(expenses, {})).expenses, 1700n)
  assert.equal(financialMetrics(stats.metrics, filterExpenses(expenses, { eventId: 'none' })).expenses, 900n)
  assert.deepEqual(stats.events.find(row => row.id === empty.id)?.financial, { expenses: 0n, netProfit: 0n, netMargin: undefined })
})
test('costos desconocidos bloquean utilidad, provisionales y estimados conservan condición', () => {
  for (const cost of [{ source: 'unknown' as const, isProvisional: false }, { source: 'average' as const, unitCost: 100, isProvisional: true }, { source: 'estimated' as const, unitCost: 100, isProvisional: false }]) {
    const metrics = buildAnalytics([sale({ items: [line({ cost })] })], []).metrics
    const financial = financialMetrics(metrics, [expense({ amount: 200 })])
    assert.equal(financial.expenses, 200n); assert.equal(metrics.revenue, 1800n)
    if (cost.source === 'unknown') { assert.equal(financial.netProfit, undefined); assert.equal(financial.netMargin, undefined) }
    else { assert.equal(financial.netProfit, 1400n); assert.equal(cost.isProvisional ? metrics.provisionalUnits : metrics.estimatedUnits, 2) }
  }
})
test('pagos divididos, descuentos y copias históricas: no se duplican importes', () => {
  const receipt = sale({ payments: [{ id: id(), saleId: id(), method: 'cash', amount: 1000, createdAt: '' }, { id: id(), saleId: id(), method: 'debit', amount: 800, createdAt: '' }], generalDiscount: { type: 'fixed', value: 200, source: 'manual', baseAmount: 2000, amount: 200 } })
  const copy = structuredClone(receipt), metrics = buildAnalytics([receipt], []).metrics
  assert.equal(metrics.revenue, 1800n); assert.equal(metrics.recordedCost, 200n); assert.equal(metrics.averageTicket, 1800n)
  assert.equal(financialMetrics(metrics, [expense({ amount: 100 })]).netProfit, 1500n)
  assert.deepEqual(receipt, copy)
})
test('días de Chile, gastos en su fecha y fuera de fechas: no redistribución', () => {
  const feria = event()
  const records = buildAnalytics([sale({ soldAt: '2026-10-15T02:59:59Z' }), sale({ soldAt: '2026-10-15T03:00:00Z' })], []).records
  const expenses = [expense({ amount: 100, date: '2026-10-14' }), expense({ amount: 200, date: '2026-10-15' }), expense({ amount: 300, date: '2026-10-13' })]
  const days = financialDayStatistics(records, expenses, feria)
  assert.equal(days.days[0].financial.expenses, 100n); assert.equal(days.days[1].financial.expenses, 200n); assert.equal(days.days[2].financial.expenses, 0n)
  assert.equal(days.days[0].metrics.transactions, 1); assert.equal(days.days[1].metrics.transactions, 1)
  assert.equal(days.outside[0].day, '2026-10-13'); assert.equal(days.outside[0].financial.netProfit, -300n)
  assert.equal(filterExpenses(expenses, { start: '2026-10-15', end: '2026-10-15' }).length, 1)
})
test('margen negativo y cero ingresos no se confunden con caja ni división por cero', () => {
  const metrics = buildAnalytics([sale({ total: 0 })], []).metrics
  assert.equal(financialMetrics(metrics, [expense({ amount: 10 })]).netProfit, -210n)
  assert.equal(financialMetrics(metrics, []).netMargin, undefined)
  const negative = financialMetrics(buildAnalytics([sale({ total: 3, items: [line({ cost: { source: 'average', unitCost: 0, isProvisional: false } })] })], []).metrics, [expense({ amount: 4 })])
  assert.equal(negative.netMargin, -33.33)
})
test('desglose sin fechas planificadas conserva días con solo gastos', () => {
  const days = financialDayStatistics([], [expense({ amount: 100, date: '2026-10-14' }), expense({ amount: 50, date: '2026-10-16' })])
  assert.equal(days.dayCount, 3)
  assert.deepEqual(days.days.map(row => row.financial.netProfit), [-100n, 0n, -50n])
  assert(days.days.every(row => row.metrics.revenue === 0n && row.financial.netMargin === undefined))
})
test('migración v8→v9 preserva todos los registros, rollback y reapertura sin duplicados', async () => {
  const { name } = setup(), catalog = new CatalogRepository(name), sales = new SalesRepository(name)
  const product = await catalog.createProduct({ id: id(), name: 'Pack histórico', kind: 'pack', packContents: [], price: 1000, initialCost: 100, initialStock: 5, categoryIds: [], isFavorite: true, lowStockThreshold: 2, image: new Blob(['original'], { type: 'image/png' }) })
  const receipt = await sales.confirm({ operationId: id(), items: [{ productId: product.id, quantity: 1, unitPrice: 1000, expectedRevision: 1 }], payments: [{ method: 'cash', amount: 1000 }] })
  await catalog.close(); await sales.close()
  const source = await openCatalogDatabase(name), stores = [...source.objectStoreNames].filter(store => !['expenses', 'expenseChanges', 'expenseCategories', 'importRecords'].includes(store))
  const snapshots = new Map<string, unknown[]>()
  const schema = stores.map(name => { const store = source.transaction(name).objectStore(name); return { name, keyPath: store.keyPath, indexes: [...store.indexNames].map(key => { const index = store.index(key as never); return { name: key, keyPath: index.keyPath, unique: index.unique } }) } })
  for (const store of stores) snapshots.set(store, await source.getAll(store)); source.close()
  const legacyName = `legacy-expenses-${id()}`
  const legacy = await openDB(legacyName, 8, { upgrade(db) { for (const entry of schema) { const store = db.createObjectStore(entry.name, { keyPath: entry.keyPath }); for (const index of entry.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique }) } } })
  for (const [store, rows] of snapshots) for (const row of rows) await legacy.put(store, row); legacy.close()
  const create = IDBDatabase.prototype.createObjectStore
  IDBDatabase.prototype.createObjectStore = function(name, options) { if (name === 'expenseChanges') throw new DOMException('Sin espacio', 'QuotaExceededError'); return create.call(this, name, options) }
  try { await assert.rejects(openCatalogDatabase(legacyName)) } finally { IDBDatabase.prototype.createObjectStore = create }
  const untouched = await openDB(legacyName, 8); assert.deepEqual(await untouched.get('sales', receipt.id), receipt); assert.equal(untouched.objectStoreNames.contains('expenses'), false); untouched.close()
  for (let n = 0; n < 2; n++) {
    const migrated = await openCatalogDatabase(legacyName); assert.equal(migrated.version, 10)
    for (const [store, rows] of snapshots) assert.deepEqual(await migrated.getAll(store as 'products'), rows)
    assert.equal(await migrated.count('expenseCategories'), 7); assert.equal(await migrated.count('expenses'), 0); migrated.close()
  }
  const expenses = new ExpenseRepository(legacyName)
  await expenses.save({ id: id(), operationId: id(), fields: fields() })
  const after = await openCatalogDatabase(legacyName); assert.deepEqual(await after.get('sales', receipt.id), receipt); assert.equal((await after.get('products', product.id))?.stock, 4); after.close()
})
