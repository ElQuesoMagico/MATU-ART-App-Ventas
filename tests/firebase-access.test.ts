import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAccess, firebaseMessage } from '../src/services/firebase/access.ts'
test('Firebase access requires enabled membership and supported workspace', () => {
  for (const role of ['administrator', 'manager', 'seller']) assert.equal(parseAccess({ role, enabled: true }, { name: 'MATU ART', schemaVersion: 1 }).role, role)
  for (const member of [undefined, {}, { role: 'administrator', enabled: false }, { role: 'owner', enabled: true }, { role: 'seller', enabled: 'true' }]) assert.throws(() => parseAccess(member, { name: 'MATU ART', schemaVersion: 1 }))
  for (const workspace of [undefined, {}, { name: 'MATU ART', schemaVersion: '1' }, { name: '', schemaVersion: 1 }]) assert.throws(() => parseAccess({ role: 'seller', enabled: true }, workspace))
})
test('Firebase errors hide account existence and backend payloads', () => {
  assert.equal(firebaseMessage({ code: 'auth/user-not-found' }), firebaseMessage({ code: 'auth/wrong-password' }))
  assert.match(firebaseMessage({ code: 'permission-denied' }), /acceso/)
  assert.match(firebaseMessage({ code: 'auth/network-request-failed' }), /locales/)
  assert.doesNotMatch(firebaseMessage({ code: 'unknown', message: 'sensitive payload' }), /sensitive/)
})
