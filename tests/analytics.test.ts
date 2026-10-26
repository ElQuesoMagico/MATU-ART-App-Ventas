import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAnalytics, eventDayStatistics, filterAnalytics, historicalLineRevenues, rankProducts, summarizeSales } from '../src/services/analytics.ts'
import type { StoredSale, StoredSaleItem } from '../src/types/sales.ts'
import type { CatalogEvent } from '../src/types/events.ts'
import type { Promotion } from '../src/types/promotions.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { openCatalogDatabase, CATALOG_DB_VERSION } from '../src/services/catalogDatabase.ts'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const id = () => crypto.randomUUID()
const event = (patch: Partial<CatalogEvent> = {}): CatalogEvent => ({ id: id(), name: 'Feria', startDate: '2026-10-12', endDate: '2026-10-14', status: 'finished', createdAt: '', updatedAt: '', ...patch })
const item = (patch: Partial<StoredSaleItem> = {}): StoredSaleItem => ({ productId: id(), name: 'Print histórico', categoryIds: [], quantity: 2, unitPrice: 1000, lineTotal: 2000, netLineTotal: 2000, cost: { unitCost: 200, source: 'average', condition: 'known', isProvisional: false }, stock: { quantitySold: 2, previousStock: 7, quantityDeducted: 2, resultingStock: 5, uncoveredQuantity: 0 }, ...patch })
const sale = (patch: Partial<StoredSale> = {}): StoredSale => ({ id: id(), operationId: id(), operationFingerprint: '', number: 1, soldAt: '2026-10-13T12:00:00Z', createdAt: '', items: [item()], subtotal: 2000, discount: 0, total: 2000, payments: [], status: 'completed', stockDifferences: [], movementIds: [], ...patch })

test('ingresos por evento: ventas reales agrupadas por UUID, incluso con nombres iguales', () => {
  const a = event(), b = event()
  const stats = buildAnalytics([sale({ event: a }), sale({ event: b, total: 1000 }), sale({ event: a, total: 500 })], [a, b])
  assert.equal(stats.events.find(row => row.id === a.id)?.metrics.revenue, 2500n)
  assert.equal(stats.events.find(row => row.id === b.id)?.metrics.revenue, 1000n)
  assert.equal(stats.metrics.transactions, 3)
})
test('anulaciones excluidas de ingresos, unidades, costos y ranking; referencias no se pierden', () => {
  const voided = sale({ status: 'voided', event: { id: id(), name: 'Evento histórico' } })
  const stats = buildAnalytics([sale(), voided], [])
  assert.equal(stats.metrics.revenue, 2000n); assert.equal(stats.metrics.units, 2)
  assert.equal(stats.metrics.recordedCost, 400n); assert.equal(rankProducts(stats.records).length, 1)
  assert.equal(stats.events[0].metrics.transactions, 0); assert.equal(voided.status, 'voided')
})
test('ventas sin evento incluidas globalmente y filtrables con período local inclusivo', () => {
  const records = buildAnalytics([sale(), sale({ event: event() }), sale({ soldAt: '2026-10-14T03:00:00Z' })], []).records
  assert.equal(summarizeSales(filterAnalytics(records, { eventId: 'none' })).transactions, 2)
  assert.equal(summarizeSales(filterAnalytics(records, { start: '2026-10-13', end: '2026-10-13' })).transactions, 2)
})
test('ticket promedio, cantidades vendidas y cero: pesos enteros con mitades hacia arriba', () => {
  const stats = buildAnalytics([sale({ total: 5 }), sale({ total: 0 })], []).metrics
  assert.equal(stats.transactions, 2); assert.equal(stats.averageTicket, 3n); assert.equal(stats.units, 4)
  assert.equal(buildAnalytics([], []).metrics.averageTicket, 0n)
})
test('costos históricos conocidos y cero son distintos de desconocidos', () => {
  assert.equal(buildAnalytics([sale()], []).metrics.grossProfit, 1600n)
  const zero = buildAnalytics([sale({ items: [item({ cost: { source: 'average', unitCost: 0, isProvisional: false } })] })], []).metrics
  assert.equal(zero.recordedCost, 0n); assert.equal(zero.grossProfit, 2000n); assert.equal(zero.unknownUnits, 0)
})
test('utilidad provisional etiquetada; costos desconocidos no se convierten en cero', () => {
  const provisional = sale({ items: [item({ cost: { source: 'average', unitCost: 200, isProvisional: true } })] })
  const unknown = sale({ items: [item({ cost: { source: 'unknown', isProvisional: false } })] })
  const estimated = sale({ items: [item({ cost: { source: 'estimated', unitCost: 300, isProvisional: false } })] })
  const a = buildAnalytics([provisional], []).metrics
  assert.equal(a.grossProfit, 1600n); assert.equal(a.provisionalUnits, 2)
  const b = buildAnalytics([provisional, unknown, estimated], []).metrics
  assert.equal(b.grossProfit, undefined); assert.equal(b.recordedCost, 1000n); assert.equal(b.unknownUnits, 2); assert.equal(b.estimatedUnits, 2); assert.equal(b.uncertainSales, 3)
})
test('días de evento: huecos en cero, ingresos en fecha real y ventas fuera del programa conservadas', () => {
  const e = event()
  const stats = buildAnalytics([sale({ event: e, soldAt: '2026-10-12T15:00:00Z' }), sale({ event: e, soldAt: '2026-10-14T15:00:00Z', total: 3000 }), sale({ event: e, soldAt: '2026-10-15T15:00:00Z', total: 700 })], [e])
  const days = eventDayStatistics(stats.records, e)
  assert.deepEqual(days.days.map(row => row.metrics.revenue), [2000n, 0n, 3000n])
  assert.equal(days.outside[0].metrics.revenue, 700n); assert.equal(stats.metrics.revenue, 5700n)
  assert.equal(days.days[0].metrics.units, 2); assert.equal(days.days[1].metrics.grossProfit, 0n)
})
test('Chile: cambio de día y horario de verano, independiente de zona del equipo', () => {
  const previous = process.env.TZ
  try {
    for (const zone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = zone
      const dates = ['2026-10-13T02:59:59Z', '2026-10-13T03:00:00Z', '2026-07-13T03:59:59Z', '2026-07-13T04:00:00Z', '2026-09-06T03:59:59Z', '2026-09-06T04:00:00Z', '2026-04-05T02:59:59Z', '2026-04-05T03:00:00Z', '2026-04-05T04:00:00Z']
      assert.deepEqual(buildAnalytics(dates.map(soldAt => sale({ soldAt })), []).records.map(row => row.day), ['2026-10-12', '2026-10-13', '2026-07-12', '2026-07-13', '2026-09-05', '2026-09-06', '2026-04-04', '2026-04-04', '2026-04-05'])
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})
test('ranking por UUID: nombre histórico más reciente, nombres anteriores y orden estable', () => {
  const p = id(), q = id()
  const records = buildAnalytics([sale({ soldAt: '2026-10-12T15:00:00Z', items: [item({ productId: p, name: 'Nombre anterior' })] }), sale({ items: [item({ productId: p, name: 'Nombre vendido' })] }), sale({ items: [item({ productId: q, name: 'Otro', quantity: 1 })], total: 6000 })], []).records
  const byUnits = rankProducts(records)
  assert.equal(byUnits[0].id, p); assert.equal(byUnits[0].name, 'Nombre vendido'); assert.deepEqual(byUnits[0].historicalNames, ['Nombre anterior', 'Nombre vendido'])
  assert.equal(byUnits[0].share, 40); assert.equal(rankProducts(records, 'revenue')[0].id, q)
  assert.equal(rankProducts(records, 'profit')[0].id, q)
})
test('descuentos generales se atribuyen exactamente con desempate UUID; legacy permanece legible', () => {
  const receipt = sale({ total: 1, items: [item({ productId: 'b', quantity: 1, lineTotal: 1, netLineTotal: 1 }), item({ productId: 'a', quantity: 1, lineTotal: 1, netLineTotal: 1 })] })
  assert.deepEqual(historicalLineRevenues(receipt), [0n, 1n])
  assert.deepEqual(historicalLineRevenues(sale({ total: 1800, items: [item({ netLineTotal: undefined })] })), [1800n])
  const ranked = rankProducts(buildAnalytics([receipt], []).records)
  assert.equal(ranked.reduce((sum, row) => sum + row.metrics.revenue, 0n), 1n)
})
test('pagos divididos no duplican ingresos; las unidades no cubiertas y packs cuentan como vendidos', () => {
  const receipt = sale({ payments: [{ id: id(), saleId: id(), method: 'cash', amount: 500, createdAt: '' }, { id: id(), saleId: id(), method: 'transfer', amount: 1500, createdAt: '' }], items: [item({ productKind: 'pack', quantity: 8, stock: { quantitySold: 8, previousStock: 7, quantityDeducted: 7, resultingStock: 0, uncoveredQuantity: 1 } })] })
  const stats = buildAnalytics([receipt], []).metrics
  assert.equal(stats.revenue, 2000n); assert.equal(stats.transactions, 1); assert.equal(stats.units, 8); assert.equal(stats.recordedCost, 1600n)
})
test('ranking: utilidad negativa válida, desconocida al final y participación redondeada a dos decimales', () => {
  const known = sale({ items: [item({ productId: 'known', cost: { source: 'average', unitCost: 2000, isProvisional: false } })], total: 1000 })
  const unknown = sale({ items: [item({ productId: 'unknown', cost: { source: 'unknown', isProvisional: false } })], total: 1200 })
  const rows = rankProducts(buildAnalytics([unknown, known], []).records, 'profit')
  assert.equal(rows[0].id, 'known'); assert.equal(rows[0].metrics.grossProfit, -3000n)
  assert.equal(rows[1].metrics.grossProfit, undefined); assert.equal(rows[0].share, 45.45); assert.equal(rows[1].share, 54.55)
})
test('eventos sin ventas en cero y con venta gratuita sí cuentan como actividad', () => {
  const empty = event(), free = event()
  const stats = buildAnalytics([sale({ event: free, total: 0 })], [empty, free])
  assert.equal(stats.events[0].id, free.id); assert.equal(stats.events[0].metrics.transactions, 1)
  assert.equal(stats.events[1].metrics.revenue, 0n); assert.equal(stats.events[1].metrics.transactions, 0)
  assert.equal(eventDayStatistics([], empty).days.length, 3)
})
test('calendarios largos paginados sin asignar años de filas vacías', () => {
  const days = eventDayStatistics([], event({ startDate: '2000-01-01', endDate: '2099-12-31' }), 31)
  assert.equal(days.days.length, 31); assert.equal(days.days[0].day, '2000-02-01'); assert.ok(days.dayCount > 36_000)
})
test('miles de ventas: sumas exactas incluso sobre el límite entero seguro, sin mutar entradas', () => {
  const receipt = sale({ total: Number.MAX_SAFE_INTEGER, items: [item({ lineTotal: Number.MAX_SAFE_INTEGER, netLineTotal: Number.MAX_SAFE_INTEGER })] })
  const input = Array.from({ length: 5000 }, (_, index) => ({ ...receipt, id: String(index) }))
  const before = structuredClone(receipt)
  const stats = buildAnalytics(input, [])
  assert.equal(stats.metrics.revenue, BigInt(Number.MAX_SAFE_INTEGER) * 5000n); assert.deepEqual(receipt, before)
})
test('persistencia, promociones, combos, descuento manual, precio especial, archivo y anulación: resumen histórico intacto', async () => {
  const dbName = `analytics71-${id()}`, catalog = new CatalogRepository(dbName), sales = new SalesRepository(dbName), events = new EventRepository(dbName), promotions = new PromotionRepository(dbName)
  const e = await events.save(id(), { name: 'Feria real de prueba', startDate: '2026-10-13', endDate: '2026-10-14' })
  await events.activate(e.id, e.updatedAt)
  let p = await catalog.createProduct({ id: id(), name: 'Nombre histórico', categoryIds: [], price: 1000, initialCost: 200, initialStock: 10, lowStockThreshold: 1, isFavorite: false })
  p = await catalog.updateProduct(p.id, { ...p, eventPrices: [{ eventId: e.id, price: 800 }] }, p.revision)
  const promo: Promotion = { id: id(), name: 'Dos unidades', type: 'quantity', groupQuantity: 2, value: 1000, productIds: [p.id], categoryIds: [], familyIds: [], ipIds: [], minimumQuantity: 0, minimumAmount: 0, isActive: true, isArchived: false, isStackable: true, createdAt: '', updatedAt: '' }
  await promotions.save(promo)
  const percentage = await promotions.save({ ...promo, id: id(), name: 'Adicional', type: 'percentage', groupQuantity: undefined, value: 10 })
  const original = await sales.confirm({ operationId: id(), items: [{ productId: p.id, quantity: 2, unitPrice: 800, expectedRevision: p.revision, discount: { type: 'fixed', value: 100 } }], generalDiscount: { type: 'fixed', value: 100 }, payments: [{ method: 'cash', amount: 300 }, { method: 'debit', amount: 500 }] })
  assert.equal(original.total, 800); assert.ok(original.appliedCombos?.length); assert.ok(original.appliedPromotions?.length)
  let latest = (await catalog.snapshot()).products[0]
  latest = await catalog.updateProduct(p.id, { ...latest, name: 'Nombre actual', price: 9999, estimatedUnitCost: 9999 }, latest.revision)
  await catalog.setArchived(p.id, true, latest.revision)
  await promotions.save({ ...percentage, value: 80, isArchived: true }, percentage.updatedAt)
  await sales.close(); await catalog.close()
  const persisted = await new SalesRepository(dbName).snapshot()
  const stats = buildAnalytics(persisted.sales, persisted.realEvents)
  assert.equal(stats.metrics.revenue, 800n); assert.equal(stats.metrics.recordedCost, 400n); assert.equal(stats.metrics.grossProfit, 400n)
  assert.equal(rankProducts(stats.records)[0].name, 'Nombre histórico'); assert.equal(rankProducts(stats.records)[0].metrics.revenue, 800n)
  assert.deepEqual(persisted.sales[0], original)
  const db = await openCatalogDatabase(dbName); assert.equal(db.version, CATALOG_DB_VERSION); assert.equal(db.version, 10); db.close()
  await sales.voidSale({ saleId: original.id, operationId: id(), reason: 'Prueba', returnStock: true })
  const after = await sales.snapshot(); assert.equal(buildAnalytics(after.sales, after.realEvents).metrics.revenue, 0n); assert.deepEqual(after.sales[0].appliedCombos, original.appliedCombos); assert.deepEqual(after.sales[0].payments, original.payments)
  await sales.close(); await catalog.close()
})
test('manifiesto: IDs únicos, archivos localizables y origen respaldado explícitamente', () => {
  const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8')) as { resources: { id: string; path: string; origin: string; evidence: string; artistNotes: string }[] }
  assert.equal(new Set(manifest.resources.map(row => row.id)).size, manifest.resources.length)
  for (const row of manifest.resources) {
    assert.ok(row.evidence); assert.ok(row.artistNotes); assert.ok(['confirmed-ai', 'not-ai', 'pending-verification'].includes(row.origin))
    if (!row.path.startsWith('IndexedDB:')) assert.ok(existsSync(resolve(row.path.split('#')[0])), row.path)
  }
})
