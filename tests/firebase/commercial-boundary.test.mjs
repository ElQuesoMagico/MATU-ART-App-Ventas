import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, writeBatch } from 'firebase/firestore'

let env
const root = 'workspaces/boundary'
const entities = ['sales', 'payments', 'inventory', 'movements', 'costs', 'costChanges', 'events', 'settings', 'saleVoids', 'commercialOperations', 'commercialRequests']
before(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local emulator required')
  env = await initializeTestEnvironment({ projectId: 'demo-matu-commercial-boundary', firestore: {
    host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../../firestore.catalog.rules', import.meta.url), 'utf8'),
  } })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    for (const role of ['administrator', 'manager', 'seller']) {
      await setDoc(doc(context.firestore(), `${root}/members/${role}`), { role, enabled: true })
    }
  })
})
after(async () => { await env?.cleanup() })

for (const role of ['administrator', 'manager', 'seller', null]) {
  test(`commercial writes remain denied for ${role ?? 'anonymous'}`, async () => {
    const db = (role ? env.authenticatedContext(role) : env.unauthenticatedContext()).firestore()
    for (const entity of entities) {
      await assertFails(setDoc(doc(db, `${root}/${entity}/${crypto.randomUUID()}`), {
        operationId: crypto.randomUUID(), stock: 999, total: 1, payments: [{ method: 'cash', amount: 1 }],
      }))
    }
  })
}

test('a valid catalog write mixed with an unauthorized sale is rejected atomically', async () => {
  const db = env.authenticatedContext('administrator').firestore()
  // This fixture is deliberately allowed by the existing name reservation rule;
  // adding a forbidden sale must still abort the whole batch.
  const id = crypto.randomUUID(), key = `categories/${id}`, name = 'Atomic boundary'
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `${root}/${key}`), { payload: { id, entity: 'categories', name } })
  })
  const reservation = doc(db, `${root}/catalogNames/categories_${name.toLowerCase()}`)
  const batch = writeBatch(db)
  batch.set(reservation, { entity: 'categories', id })
  batch.set(doc(db, `${root}/sales/${crypto.randomUUID()}`), { total: 1 })
  await assertFails(batch.commit())
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDoc(doc(context.firestore(), reservation.path))).exists(), false)
  })
})
