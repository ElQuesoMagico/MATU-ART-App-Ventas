import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateSalePricing, applyManualDiscount } from '../src/services/discountRules.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { evaluatePaymentAmounts } from '../src/services/paymentEntry.ts'
import type { ManualDiscount } from '../src/types/discounts.ts'
const line = (discount?: ManualDiscount) => ({ productId: 'product', quantity: 2, unitPrice: 1000, discount })
for (const [label, individual, general, total] of [
  ['sin descuentos', undefined, undefined, 2000],
  ['porcentaje por producto', { type: 'percentage', value: 25 }, undefined, 1500],
  ['fijo por producto (importe de linea)', { type: 'fixed', value: 300 }, undefined, 1700],
  ['porcentaje general', undefined, { type: 'percentage', value: 10 }, 1800],
  ['fijo general', undefined, { type: 'fixed', value: 500 }, 1500],
  ['combinacion ordenada', { type: 'percentage', value: 25 }, { type: 'percentage', value: 10 }, 1350],
  ['100 por ciento en linea', { type: 'percentage', value: 100 }, undefined, 0],
  ['100 por ciento general', { type: 'fixed', value: 500 }, { type: 'percentage', value: 100 }, 0],
] as const) test(label, () => {
  const input = [line(individual)]; const copy = structuredClone(input)
  const pricing = calculateSalePricing(input, general)
  assert.equal(pricing.subtotal, 2000); assert.equal(pricing.total, total); assert.equal(pricing.discount, 2000-total)
  assert.deepEqual(input, copy)
})
test('redondeo por descuento al peso mas cercano, mitad hacia arriba y porcentajes con dos decimales', () => {
  assert.equal(applyManualDiscount(101, { type: 'percentage', value: 50 })!.amount, 51)
  assert.equal(applyManualDiscount(10000, { type: 'percentage', value: 12.34 })!.amount, 1234)
  assert.equal(calculateSalePricing([{ productId: 'a', quantity: 1, unitPrice: 101 }, { productId: 'b', quantity: 1, unitPrice: 101 }], { type: 'percentage', value: 50 }).total, 101)
  assert.equal(calculateSalePricing([{ productId: 'a', quantity: 1, unitPrice: 101, discount: { type: 'percentage', value: 50 } }, { productId: 'b', quantity: 1, unitPrice: 101, discount: { type: 'percentage', value: 50 } }]).total, 100)
})
test('rechaza negativos, porcentajes fuera de rango, montos excesivos o decimales y cantidades invalidas', () => {
  for (const discount of [{ type: 'percentage', value: 101 }, { type: 'percentage', value: -1 }, { type: 'percentage', value: 1.234 }, { type: 'fixed', value: 2001 }, { type: 'fixed', value: 1.5 }, { type: 'fixed', value: NaN }, { type: 'fixed', value: Infinity }] as ManualDiscount[]) assert.throws(() => calculateSalePricing([line(discount)]))
  assert.throws(() => calculateSalePricing([line({ type: 'fixed', value: 500 })], { type: 'fixed', value: 1501 }))
  assert.throws(() => calculateSalePricing([{ ...line(), quantity: 0 }]))
  assert.throws(() => calculateSalePricing([{ ...line(), unitPrice: Number.MAX_SAFE_INTEGER }]))
  assert.throws(() => applyManualDiscount(100, { type: 'invalid', value: 1 } as unknown as ManualDiscount))
})
async function setup() {
  const name = `discount-${crypto.randomUUID()}`; const catalog = new CatalogRepository(name); const sales = new SalesRepository(name)
  const product = await catalog.createProduct({ id: crypto.randomUUID(), name: 'Print', categoryIds: [], price: 1000, initialStock: 7, initialCost: 200, estimatedUnitCost: 300, lowStockThreshold: 1, isFavorite: false })
  return { name, catalog, sales, product }
}
test('pagos divididos, copias historicas, persistencia, costos y anulacion de descuentos', async () => {
  const { name, catalog, sales, product } = await setup()
  const individual: ManualDiscount = { type: 'percentage', value: 25 }; const general: ManualDiscount = { type: 'fixed', value: 100 }
  const input = { operationId: crypto.randomUUID(), items: [{ productId: product.id, unitPrice: product.price, quantity: 2, expectedRevision: product.revision, discount: individual }], generalDiscount: general, payments: evaluatePaymentAmounts({ cash: '400', transfer: '500', debit: '500' }, 1400).payments }
  const [saved, retry] = await Promise.all([sales.confirm(input), sales.confirm(input)])
  assert.deepEqual(saved, retry); assert.equal(saved.subtotal, 2000); assert.equal(saved.discount, 600); assert.equal(saved.total, 1400)
  assert.equal(saved.items[0].unitPrice, 1000); assert.equal(saved.items[0].lineTotal, 2000); assert.equal(saved.items[0].netLineTotal, 1500)
  assert.deepEqual(saved.items[0].appliedDiscount, { ...individual, source: 'manual', baseAmount: 2000, amount: 500 })
  assert.deepEqual(saved.generalDiscount, { ...general, source: 'manual', baseAmount: 1500, amount: 100 })
  const current = (await catalog.snapshot()).products[0]
  assert.equal(current.price, 1000); assert.equal(current.stock, 5); assert.equal(current.averageCost, 200); assert.equal(current.lastKnownCost, 200); assert.equal(current.estimatedUnitCost, 300)
  await catalog.updateProduct(product.id, { ...current, price: 2000 }, current.revision)
  await sales.close(); const reopened = new SalesRepository(name)
  assert.deepEqual((await reopened.snapshot()).sales[0], saved)
  await assert.rejects(reopened.confirm({ ...input, generalDiscount: { type: 'fixed', value: 200 } }))
  const voided = await reopened.voidSale({ saleId: saved.id, operationId: crypto.randomUUID(), reason: 'Prueba', returnStock: true })
  assert.deepEqual(voided.items, saved.items); assert.deepEqual(voided.generalDiscount, saved.generalDiscount); assert.deepEqual(voided.payments, saved.payments); assert.equal(voided.discount, 600)
  assert.equal((await catalog.snapshot()).products[0].stock, 7)
  await catalog.close(); await reopened.close()
})
test('venta cero, validacion de pagos y descuentos excesivos no escriben nada', async () => {
  const { catalog, sales, product } = await setup()
  const input = { operationId: crypto.randomUUID(), items: [{ productId: product.id, unitPrice: product.price, quantity: 1, expectedRevision: product.revision }], payments: [] }
  await assert.rejects(sales.confirm({ ...input, generalDiscount: { type: 'fixed', value: 1001 } }))
  await assert.rejects(sales.confirm({ ...input, generalDiscount: { type: 'percentage', value: 50 }, payments: [{ method: 'cash', amount: 1000 }] }))
  assert.equal((await sales.snapshot()).sales.length, 0); assert.equal((await catalog.snapshot()).products[0].stock, 7); assert.equal((await catalog.listMovements({ type: 'sale' })).length, 0)
  const saved = await sales.confirm({ ...input, generalDiscount: { type: 'percentage', value: 100 } })
  assert.equal(saved.total, 0); assert.equal(saved.discount, 1000); assert.deepEqual(saved.payments, [])
  await catalog.close(); await sales.close()
})
test('ventas anteriores sin nuevos campos se leen y anulan sin reescritura', async () => {
  const { name, catalog, sales, product } = await setup()
  const saved = await sales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: product.id, unitPrice: product.price, quantity: 1, expectedRevision: product.revision }], payments: [{ method: 'cash', amount: 1000 }] })
  delete saved.calculationVersion; delete saved.generalDiscount; delete saved.items[0].netLineTotal; delete saved.items[0].appliedDiscount
  const db = await openCatalogDatabase(name); await db.put('sales', saved); db.close()
  const read = (await sales.snapshot()).sales[0]; assert.deepEqual(read, saved)
  const voided = await sales.voidSale({ saleId: saved.id, operationId: crypto.randomUUID(), reason: 'Anterior', returnStock: false })
  assert.deepEqual(voided.items, saved.items); assert.equal(voided.discount, 0); assert.deepEqual(voided.payments, saved.payments)
  await catalog.close(); await sales.close()
})

test('confirmar y anular descuentos sin APIs de red', async () => {
  const fetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Sin red') }
  try {
    const { catalog, sales, product } = await setup()
    const saved = await sales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: product.id, quantity: 1, unitPrice: product.price, expectedRevision: product.revision, discount: { type: 'fixed', value: 100 } }], generalDiscount: { type: 'fixed', value: 200 }, payments: [{ method: 'cash', amount: 700 }] })
    assert.equal(saved.total, 700); assert.equal(saved.discount, 300)
    await sales.voidSale({ saleId: saved.id, operationId: crypto.randomUUID(), reason: 'Offline', returnStock: true })
    assert.equal((await catalog.snapshot()).products[0].stock, 7)
    await catalog.close(); await sales.close()
  } finally { globalThis.fetch = fetch }
})
