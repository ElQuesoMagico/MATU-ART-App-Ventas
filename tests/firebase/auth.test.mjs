import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'

test('Auth emulator: correct/incorrect credentials, logout and invalidated token', async () => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099')
  const app = initializeApp({ projectId: 'demo-matu-art', apiKey: 'demo-key' }, 'auth-test')
  const auth = initializeAuth(app, { persistence: inMemoryPersistence })
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const email = `test-${crypto.randomUUID()}@example.test`
  const password = 'Emulator-only-password-123!'
  try {
    const created = await createUserWithEmailAndPassword(auth, email, password)
    const uid = created.user.uid
    await signOut(auth)
    assert.equal(auth.currentUser, null)
    await assert.rejects(signInWithEmailAndPassword(auth, email, 'wrong-password'))
    const login = await signInWithEmailAndPassword(auth, email, password)
    assert.equal(login.user.uid, uid)
    await login.user.getIdToken(true)
    await login.user.delete()
    await assert.rejects(login.user.getIdToken(true))
    await signOut(auth)
    assert.equal(auth.currentUser, null)
  } finally { await deleteApp(app) }
})
