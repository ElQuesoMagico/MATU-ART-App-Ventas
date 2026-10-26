import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { CatalogRepository } from './catalogFixture.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { resolveProductPrice, priceReviewContext, samePriceContext } from '../src/services/productPricing.ts'
import { calculatePromotionPricing, promotionPricingSignature } from '../src/services/promotionRules.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import type { CatalogProduct } from '../src/types/catalog.ts'
import type { CheckoutInput } from '../src/types/sales.ts'
import type { Promotion } from '../src/types/promotions.ts'
const id = () => crypto.randomUUID()
const aId = id(), bId = id()
for (const [label, product, eventId, expected, source] of [
  ['sin excepción', { price: 1000 }, aId, 1000, 'general'],
  ['excepción activa', { price: 1000, eventPrices: [{ eventId: aId, price: 800 }] }, aId, 800, 'event'],
  ['otro evento', { price: 1000, eventPrices: [{ eventId: aId, price: 800 }] }, bId, 1000, 'general'],
  ['sin evento', { price: 1000, eventPrices: [{ eventId: aId, price: 800 }] }, undefined, 1000, 'general'],
  ['cero explícito', { price: 1000, eventPrices: [{ eventId: aId, price: 0 }] }, aId, 0, 'event'],
] as const) test(`resolver: ${label}`, () => {
  const mutable = structuredClone(product), before = structuredClone(mutable), result = resolveProductPrice(mutable, eventId)
  assert.equal(result.unitPrice, expected); assert.equal(result.source, source); assert.equal(result.generalPrice, 1000); assert.deepEqual(mutable, before)
})
async function setup() {
  const name = `event-price-${id()}`, catalog = new CatalogRepository(name), events = new EventRepository(name), sales = new SalesRepository(name), promotions = new PromotionRepository(name)
  const a = await events.save(id(), { name: 'Feria A', startDate: '2026-10-13', endDate: '2026-10-14' })
  const b = await events.save(id(), { name: 'Feria B', startDate: '2026-11-01', endDate: '2026-11-02' })
  const product = await catalog.createProduct({ id: id(), name: 'Print', categoryIds: [], price: 1000, eventPrices: [{ eventId: a.id, price: 800 }], initialStock: 7, initialCost: 200, lowStockThreshold: 1, isFavorite: false })
  return { name, catalog, events, sales, promotions, product, a, b }
}
async function review(sales: SalesRepository, products: CatalogProduct[], quantities = products.map(() => 1)): Promise<CheckoutInput> {
  const { realEvents, eventRevision } = await sales.snapshot(), context = priceReviewContext(realEvents, eventRevision)
  const items = products.map((p, i) => ({ productId: p.id, quantity: quantities[i], unitPrice: resolveProductPrice(p, context.eventId ?? undefined).unitPrice, expectedRevision: p.revision }))
  const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  return { operationId: id(), items, priceReview: context, payments: total ? [{ method: 'cash', amount: total }] : [] }
}
test('validación de duplicados, negativos, decimales, vacíos y eventos inexistentes; creación idempotente', async () => {
  const { catalog, sales, product, a } = await setup()
  for (const prices of [[{ eventId: a.id, price: -1 }], [{ eventId: a.id, price: 1.5 }], [{ eventId: a.id, price: NaN }], [{ eventId: a.id, price: 0 }, { eventId: a.id, price: 1 }], [{ eventId: id(), price: 300 }]]) await assert.rejects(catalog.updateProduct(product.id, { ...product, eventPrices: prices }, product.revision))
  assert.deepEqual((await catalog.snapshot()).products[0], product)
  const input = { id: id(), name: 'Segundo', categoryIds: [], price: 500, eventPrices: [{ eventId: a.id, price: 0 }], initialStock: 1, lowStockThreshold: 1, isFavorite: false }
  const [first, second] = await Promise.all([catalog.createProduct(input), catalog.createProduct(input)]); assert.equal(first.id, second.id)
  assert.equal((await catalog.snapshot()).products.length, 2); await catalog.close(); await sales.close()
})
test('editar/eliminar excepciones conserva precio general, costos, movimientos y otras asociaciones', async () => {
  const { catalog, sales, product, a, b } = await setup(), before = await catalog.listMovements({ productId: product.id })
  const updated = await catalog.updateProduct(product.id, { ...product, eventPrices: [{ eventId: a.id, price: 750 }, { eventId: b.id, price: 900 }] }, product.revision)
  assert.equal(updated.price, 1000); assert.equal(updated.stock, 7); assert.equal(updated.averageCost, 200); assert.equal(updated.lastKnownCost, 200)
  assert.deepEqual(updated.categoryIds, product.categoryIds); assert.deepEqual(await catalog.listMovements({ productId: product.id }), before)
  const kept = await catalog.updateProduct(product.id, { ...updated, eventPrices: undefined }, updated.revision); assert.deepEqual(kept.eventPrices, updated.eventPrices)
  const cleared = await catalog.updateProduct(product.id, { ...kept, eventPrices: [] }, kept.revision); assert.deepEqual(cleared.eventPrices, [])
  await catalog.close(); await sales.close()
})
test('cambiar evento recalcula carrito conservando productos/cantidades/manuales', async () => {
  const { catalog, events, sales, product, a, b } = await setup()
  const items = [{ productId: product.id, quantity: 2, discount: { type: 'percentage' as const, value: 10 } }], original = structuredClone(items)
  const calculate = async () => { const s = await sales.snapshot(), context = priceReviewContext(s.realEvents, s.eventRevision); return calculatePromotionPricing(items.map(item => ({ ...item, unitPrice: resolveProductPrice(product, context.eventId ?? undefined).unitPrice })), [], undefined, new Date().toISOString()) }
  assert.equal((await calculate()).total, 1800)
  const active = await events.activate(a.id, a.updatedAt); assert.equal((await calculate()).total, 1440)
  const next = await events.activate(b.id, b.updatedAt, { id: active.id, updatedAt: active.updatedAt }); assert.equal((await calculate()).total, 1800)
  await events.changeState(next.id, 'upcoming', next.updatedAt); assert.equal((await calculate()).total, 1800); assert.deepEqual(items, original)
  await catalog.close(); await sales.close()
})
test('cambio durante pago rechaza con cero escrituras, incluso si los importes son iguales', async () => {
  const { catalog, events, sales, product, a } = await setup(), initial = await review(sales, [product])
  await events.activate(a.id, a.updatedAt)
  await assert.rejects(sales.confirm(initial), /evento cambió/)
  assert.equal((await sales.snapshot()).sales.length, 0); assert.equal((await catalog.snapshot()).products[0].stock, 7)
  // Un producto sin excepciones tampoco autoriza cambiar evento después de revisar.
  const normal = await catalog.createProduct({ id: id(), name: 'Normal', categoryIds: [], price: 500, initialStock: 1, lowStockThreshold: 0, isFavorite: false })
  const request = await review(sales, [normal]), active = (await events.snapshot()).find(e => e.status === 'active')!
  await events.changeState(a.id, 'upcoming', active.updatedAt); await assert.rejects(sales.confirm(request), /evento cambió/)
  await catalog.close(); await sales.close()
})
test('ida y vuelta de evento durante pago también invalida la revisión', async () => {
  const { catalog, events, sales, product, a, b } = await setup(), active = await events.activate(a.id, a.updatedAt), request = await review(sales, [product])
  const second = await events.activate(b.id, b.updatedAt, { id: active.id, updatedAt: active.updatedAt }), pending = (await events.snapshot()).find(e => e.id === a.id)!
  await events.activate(a.id, pending.updatedAt, { id: second.id, updatedAt: second.updatedAt })
  const current = await review(sales, [product]); assert.equal(current.items[0].unitPrice, request.items[0].unitPrice); assert.equal(samePriceContext(request.priceReview!, current.priceReview!), false)
  await assert.rejects(sales.confirm(request), /evento cambió/); assert.equal((await sales.snapshot()).sales.length, 0)
  await catalog.close(); await sales.close()
})
test('fallo al actualizar revisión de evento revierte estado y conserva la revisión anterior', async () => {
  const { events, catalog, sales, a } = await setup(), original = IDBObjectStore.prototype.put
  const previous = await sales.snapshot()
  IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) { if (this.name === 'metadata' && (value as { key: string }).key === 'event-price-revision') throw new DOMException('Sin espacio', 'QuotaExceededError'); return original.call(this, value, key) }
  try { await assert.rejects(events.activate(a.id, a.updatedAt)) } finally { IDBObjectStore.prototype.put = original }
  const current = await sales.snapshot(); assert.equal(current.eventRevision, previous.eventRevision); assert.equal(current.realEvents.some(e => e.status === 'active'), false)
  await catalog.close(); await sales.close()
})
test('precio especial cero: pago vacío, snapshot histórico, costos y stock intactos en reglas', async () => {
  const { catalog, events, sales, product, a } = await setup()
  const zero = await catalog.updateProduct(product.id, { ...product, eventPrices: [{ eventId: a.id, price: 0 }] }, product.revision)
  await events.activate(a.id, a.updatedAt)
  const sale = await sales.confirm(await review(sales, [zero])); assert.equal(sale.total, 0); assert.equal(sale.payments.length, 0)
  assert.equal(sale.items[0].unitPrice, 0); assert.equal(sale.items[0].priceSnapshot?.source, 'event'); assert.equal(sale.items[0].priceSnapshot?.generalPrice, 1000)
  assert.equal(sale.items[0].cost.unitCost, 200); assert.equal((await catalog.snapshot()).products[0].stock, 6)
  await catalog.close(); await sales.close()
})
test('manuales, promociones y combos usan precios efectivos en cálculo y venta con pagos divididos', async () => {
  const { catalog, events, sales, promotions, product, a } = await setup()
  const poster = await catalog.updateProduct(product.id, { ...product, price: 5000, eventPrices: [{ eventId: a.id, price: 3000 }] }, product.revision)
  const stickers = await catalog.createProduct({ id: id(), name: 'Sticker', categoryIds: [], price: 1500, eventPrices: [{ eventId: a.id, price: 1000 }], initialStock: 7, initialCost: 200, lowStockThreshold: 1, isFavorite: false })
  await events.activate(a.id, a.updatedAt)
  const now = new Date().toISOString(), base: Promotion = { id: id(), name: 'Combo', type: 'combo', value: 4500, components: [{ id: id(), kind: 'product', targetId: poster.id, quantity: 1 }, { id: id(), kind: 'product', targetId: stickers.id, quantity: 2 }], productIds: [], categoryIds: [], familyIds: [], ipIds: [], minimumQuantity: 0, minimumAmount: 0, isActive: true, isArchived: false, isStackable: true, createdAt: now, updatedAt: now }
  const combo = await promotions.save(base), promo = await promotions.save({ ...base, id: id(), name: '10%', type: 'percentage', value: 10, components: undefined })
  const request = await review(sales, [poster, stickers], [1, 2]); request.items[0].discount = { type: 'fixed', value: 100 }; request.generalDiscount = { type: 'percentage', value: 10 }
  const pricing = calculatePromotionPricing(request.items, [combo, promo], request.generalDiscount, now)
  assert.equal(pricing.subtotal, 5000); assert.equal(pricing.combos[0].amount, 400); assert.equal(pricing.total, 3645)
  request.pricingSignature = promotionPricingSignature(pricing); request.payments = [{ method: 'cash', amount: 1000 }, { method: 'transfer', amount: 2000 }, { method: 'debit', amount: 645 }]
  const sale = await sales.confirm(request); assert.equal(sale.total, 3645); assert.equal(sale.items[0].unitPrice, 3000); assert.equal(sale.items[1].unitPrice, 1000); assert.equal(sale.appliedCombos?.[0].originalAmount, 5000)
  await catalog.close(); await sales.close()
})
test('editar excepción durante pago rechaza importe desactualizado sin stock parcial', async () => {
  const { catalog, events, sales, product, a } = await setup(); await events.activate(a.id, a.updatedAt)
  const request = await review(sales, [product])
  await catalog.updateProduct(product.id, { ...product, eventPrices: [{ eventId: a.id, price: 700 }] }, product.revision)
  await assert.rejects(sales.confirm(request), /precio del evento cambió/)
  assert.equal((await sales.snapshot()).sales.length, 0); assert.equal((await catalog.snapshot()).products[0].stock, 7)
  await catalog.close(); await sales.close()
})
test('historial, reintento, eliminación/modificación posterior, stock insuficiente y anulación preservan copias', async () => {
  const { name, catalog, events, sales, product, a } = await setup(); await events.activate(a.id, a.updatedAt)
  const request = await review(sales, [product], [8]), sale = await sales.confirm(request)
  assert.equal(sale.total, 6400); assert.equal(sale.items[0].stock.uncoveredQuantity, 1)
  const current = (await catalog.snapshot()).products[0]
  await catalog.updateProduct(product.id, { ...current, price: 2000, eventPrices: [] }, current.revision)
  assert.deepEqual(await sales.confirm(request), sale)
  await catalog.close(); await sales.close(); const reopened = new SalesRepository(name)
  assert.deepEqual((await reopened.snapshot()).sales[0], sale)
  const voided = await reopened.voidSale({ saleId: sale.id, operationId: id(), reason: 'Precio histórico', returnStock: true })
  assert.deepEqual(voided.items, sale.items); assert.deepEqual(voided.event, sale.event); assert.deepEqual(voided.payments, sale.payments)
  assert.equal((await catalog.snapshot()).products[0].stock, 7)
  await catalog.close(); await reopened.close()
})
test('v8 permanece sin migración ni reescritura al abrir; excepciones persisten tras cerrar y reabrir', async () => {
  const { name, catalog, sales, product } = await setup()
  await catalog.close(); await sales.close()
  const db = await openCatalogDatabase(name), before = new Map<string, unknown[]>()
  for (const store of [...db.objectStoreNames]) before.set(store, await db.getAll(store as 'products')); db.close()
  for (let i = 0; i < 2; i++) {
    const reopened = await openCatalogDatabase(name); assert.equal(reopened.version, 10)
    for (const [store, rows] of before) assert.deepEqual(await reopened.getAll(store as 'products'), rows)
    assert.deepEqual((await reopened.get('products', product.id))?.eventPrices, product.eventPrices); reopened.close()
  }
})
test('precios especiales y venta funcionan sin APIs de red; packs conservan stock independiente', async () => {
  const { catalog, events, sales, product, a } = await setup(), fetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Sin red') }
  try {
    const pack = await catalog.createProduct({ id: id(), kind: 'pack', packContents: [{ productId: product.id, quantity: 5 }], name: 'Pack', categoryIds: [], price: 6000, eventPrices: [{ eventId: a.id, price: 5000 }], initialStock: 10, initialCost: 1000, lowStockThreshold: 1, isFavorite: false })
    await events.activate(a.id, a.updatedAt); const sale = await sales.confirm(await review(sales, [pack], [2]))
    assert.equal(sale.total, 10000); assert.equal((await catalog.snapshot()).products.find(p => p.id === pack.id)?.stock, 8); assert.equal((await catalog.snapshot()).products.find(p => p.id === product.id)?.stock, 7)
    await sales.voidSale({ saleId: sale.id, operationId: id(), reason: 'Pack', returnStock: true })
    assert.equal((await catalog.snapshot()).products.find(p => p.id === pack.id)?.stock, 10)
  } finally { globalThis.fetch = fetch; await catalog.close(); await sales.close() }
})
