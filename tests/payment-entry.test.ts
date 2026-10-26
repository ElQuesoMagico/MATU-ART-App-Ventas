import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePaymentAmounts, initialPaymentAmounts } from '../src/services/paymentEntry.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
test('inicializa el total en efectivo y los otros campos en cero', () => {
  assert.deepEqual(initialPaymentAmounts(1000), { cash: '1000', transfer: '0', debit: '0' })
})
for (const [label, amounts] of [
  ['efectivo', { cash: '1000', transfer: '0', debit: '' }],
  ['transferencia', { cash: '', transfer: '1000', debit: '0' }],
  ['debito', { cash: '0', transfer: '', debit: '1000' }],
  ['dos metodos', { cash: '400', transfer: '600', debit: '0' }],
  ['tres metodos', { cash: '200', transfer: '300', debit: '500' }],
] as const) test(`entrada y persistencia historica: ${label}`, async () => {
  const result = evaluatePaymentAmounts(amounts, 1000)
  assert.equal(result.valid, true); assert.equal(result.difference, 0n)
  assert.ok(result.payments.every(payment => payment.amount > 0))
  const dbName = `payment-entry-${crypto.randomUUID()}`
  const catalog = new CatalogRepository(dbName); const sales = new SalesRepository(dbName)
  const product = await catalog.createProduct({ id: crypto.randomUUID(), name: 'Producto de prueba', categoryIds: [], price: 1000, initialStock: 5, lowStockThreshold: 1, isFavorite: false })
  const sale = await sales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: product.id, quantity: 1, unitPrice: 1000, expectedRevision: product.revision }], payments: result.payments })
  await sales.close()
  const reopened = new SalesRepository(dbName)
  assert.deepEqual((await reopened.snapshot()).sales[0].payments, sale.payments)
  assert.deepEqual(sale.payments.map(({ method, amount }) => ({ method, amount })), result.payments)
  await reopened.close(); await catalog.close()
})
test('faltante, exceso y vacios', () => {
  assert.equal(evaluatePaymentAmounts({ cash: '400', transfer: '', debit: '' }, 1000).difference, 600n)
  assert.equal(evaluatePaymentAmounts({ cash: '1200', transfer: '0', debit: '' }, 1000).difference, -200n)
  const empty = evaluatePaymentAmounts({ cash: '', transfer: '', debit: '' }, 1000)
  assert.equal(empty.validAmounts, true); assert.equal(empty.valid, false); assert.equal(empty.paid, 0n)
})
for (const raw of ['-1', '1.5', 'abc', 'NaN', 'Infinity', '1e3', '9007199254740992']) test(`rechaza importe invalido ${raw}`, () => {
  const result = evaluatePaymentAmounts({ cash: raw, transfer: '1000', debit: '' }, 1000)
  assert.equal(result.validAmounts, false); assert.equal(result.valid, false)
})
test('suma exacta sin perdida de precision', () => {
  const result = evaluatePaymentAmounts({ cash: String(Number.MAX_SAFE_INTEGER), transfer: '1', debit: '0' }, Number.MAX_SAFE_INTEGER)
  assert.equal(result.valid, false); assert.equal(result.difference, -1n)
})
test('venta gratuita no guarda metodos con importe cero', async () => {
  const result = evaluatePaymentAmounts(initialPaymentAmounts(0), 0)
  assert.equal(result.valid, true); assert.deepEqual(result.payments, [])
  const dbName = `payment-free-${crypto.randomUUID()}`
  const catalog = new CatalogRepository(dbName); const sales = new SalesRepository(dbName)
  const product = await catalog.createProduct({ id: crypto.randomUUID(), name: 'Cortesia', categoryIds: [], price: 0, initialStock: 1, lowStockThreshold: 0, isFavorite: false })
  const sale = await sales.confirm({ operationId: crypto.randomUUID(), items: [{ productId: product.id, quantity: 1, unitPrice: 0, expectedRevision: product.revision }], payments: result.payments })
  assert.deepEqual(sale.payments, []); assert.equal(sale.total, 0)
  await catalog.close(); await sales.close()
})
