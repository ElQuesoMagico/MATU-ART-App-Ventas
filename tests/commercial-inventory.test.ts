import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planInventory, type InventoryIntent } from '../src/services/firebase/commercial/inventoryProtocol.ts'
const intent = (overrides: Partial<InventoryIntent> = {}): InventoryIntent => ({ schemaVersion: 1,
  operationId: crypto.randomUUID(), productId: crypto.randomUUID(), deviceId: crypto.randomUUID(), actorUid: 'admin',
  occurredAt: new Date().toISOString(), expectedRevision: 0, type: 'initialize', quantity: 0, unitCost: null, reason: '', ...overrides })
test('opening never imports local test balances or invents costs; zero count becomes confirmed', () => {
  const opening = intent(), balance = planInventory(opening, null).after
  assert.equal(balance.countPending, true); assert.equal(balance.costs.averageCost, null)
  assert.throws(() => planInventory(intent({ quantity: 10 }), null))
  assert.throws(() => planInventory(intent({ productId: opening.productId, type: 'adjustment', expectedRevision: 1, quantity: 3 }), balance))
  const counted = planInventory(intent({ productId: opening.productId, type: 'count', expectedRevision: 1 }), balance)
  assert.equal(counted.after.stock, 0); assert.equal(counted.after.countPending, false)
  assert.equal(balance.countPending, true, 'planner does not mutate prior state')
})
test('restock reuses weighted cost and distinguishes zero from unknown', () => {
  const opening = intent(), first = planInventory(opening, null).after
  const counted = planInventory(intent({ productId: first.productId, type: 'count', expectedRevision: 1, quantity: 10 }), first).after
  const known = { ...counted, costs: { ...counted.costs, averageCost: 100, lastKnownCost: 100, estimatedUnitCost: 777, averageCostIsProvisional: false } }
  const next = planInventory(intent({ productId: first.productId, type: 'restock', expectedRevision: 2, quantity: 10, unitCost: 0 }), known)
  assert.equal(next.after.costs.averageCost, 50); assert.equal(next.after.costs.lastKnownCost, 0)
  assert.equal(next.after.costs.estimatedUnitCost, 777)
  const unknown = planInventory(intent({ productId: first.productId, type: 'restock', expectedRevision: 2, quantity: 10 }), known)
  assert.equal(unknown.after.costs.averageCost, 100); assert.equal(unknown.after.costs.averageCostIsProvisional, true)
})
test('stale count/adjustment cannot silently replace concurrent stock', () => {
  const opening = intent(), first = planInventory(opening, null).after
  const counted = planInventory(intent({ productId: first.productId, type: 'count', expectedRevision: 1, quantity: 10 }), first).after
  const changed = planInventory(intent({ productId: first.productId, type: 'adjustment', expectedRevision: 2, quantity: -2 }), counted).after
  assert.equal(changed.stock, 8)
  for (const type of ['count', 'adjustment', 'restock'] as const) {
    assert.throws(() => planInventory(intent({ productId: first.productId, type, expectedRevision: 2, quantity: 3 }), changed), /cambió/)
  }
})
test('invalid quantities, unknown fields and overflow are rejected', () => {
  for (const quantity of [NaN, Infinity, 1.2, 1_000_000_001]) assert.throws(() => planInventory(intent({ type: 'count', quantity }), null))
  assert.throws(() => planInventory({ ...intent(), arbitrary: true } as InventoryIntent, null))
  assert.throws(() => planInventory(intent({ type: 'restock', quantity: -1 }), null))
})
