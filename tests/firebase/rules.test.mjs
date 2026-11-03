import { before, after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

const workspace = 'byhkbCSyvenq9SDAjoRm'
let env
before(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local emulator required')
  env = await initializeTestEnvironment({ projectId: 'demo-matu-art', firestore: {
    rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    host: '127.0.0.1', port: 8080,
  } })
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, `workspaces/${workspace}`), { name: 'MATU ART', schemaVersion: 1 })
    for (const [uid, role, enabled] of [['admin', 'administrator', true], ['manager', 'manager', true], ['seller', 'seller', true], ['disabled', 'administrator', false], ['invalid', 'owner', true]]) {
      await setDoc(doc(db, `workspaces/${workspace}/members/${uid}`), { role, enabled })
    }
    await setDoc(doc(db, `workspaces/${workspace}/products/product`), { name: 'Test only' })
  })
})
after(async () => { await env?.cleanup() })

for (const uid of ['admin', 'manager', 'seller']) {
  test(`${uid}: own membership and workspace only`, async () => {
    const db = env.authenticatedContext(uid).firestore()
    await assertSucceeds(getDoc(doc(db, `workspaces/${workspace}`)))
    await assertSucceeds(getDoc(doc(db, `workspaces/${workspace}/members/${uid}`)))
    await assertFails(getDoc(doc(db, `workspaces/${workspace}/members/${uid === 'admin' ? 'seller' : 'admin'}`)))
    await assertFails(getDocs(collection(db, `workspaces/${workspace}/members`)))
    await assertFails(getDocs(collection(db, 'workspaces')))
    await assertFails(getDoc(doc(db, 'workspaces/another-workspace')))
    await assertFails(updateDoc(doc(db, `workspaces/${workspace}/members/${uid}`), { role: 'administrator' }))
    await assertFails(setDoc(doc(db, `workspaces/${workspace}/members/new-user`), { role: 'administrator', enabled: true }))
    await assertFails(deleteDoc(doc(db, `workspaces/${workspace}/members/${uid}`)))
    await assertFails(updateDoc(doc(db, `workspaces/${workspace}`), { name: 'Changed' }))
    for (const entity of ['products', 'sales', 'movements', 'payments', 'operations']) {
      await assertFails(getDoc(doc(db, `workspaces/${workspace}/${entity}/product`)))
      await assertFails(setDoc(doc(db, `workspaces/${workspace}/${entity}/product`), { value: 1 }))
    }
  })
}
for (const uid of [null, 'missing', 'disabled', 'invalid']) {
  test(`${uid ?? 'anonymous'}: access denied`, async () => {
    const db = (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore()
    await assertFails(getDoc(doc(db, `workspaces/${workspace}`)))
    await assertFails(getDoc(doc(db, `workspaces/${workspace}/members/${uid ?? 'admin'}`)))
  })
}
test('client claims cannot replace membership', async () => {
  const db = env.authenticatedContext('outsider', { role: 'administrator', enabled: true }).firestore()
  await assertFails(getDoc(doc(db, `workspaces/${workspace}`)))
})
