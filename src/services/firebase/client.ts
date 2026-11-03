import { initializeApp } from 'firebase/app'
import { initializeAuth, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { initializeFirestore, memoryLocalCache, doc, getDocFromServer } from 'firebase/firestore'
import { parseAccess } from './access'
export interface FirebaseIdentity { uid: string; email: string | null }
function initializeConnection() {
  const env = import.meta.env
  const options = { apiKey: env.VITE_FIREBASE_API_KEY?.trim(), authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim(), projectId: env.VITE_FIREBASE_PROJECT_ID?.trim(), appId: env.VITE_FIREBASE_APP_ID?.trim() }
  const workspaceId = env.VITE_FIREBASE_WORKSPACE_ID?.trim() ?? ''
  const values = [...Object.values(options), workspaceId]
  if (values.every(value => !value)) return null
  if (values.some(value => !value) || !/^[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error('La configuración de Firebase está incompleta o es inválida.')
  const app = initializeApp(options, 'matu-art')
  // SDK sessionStorage only; never persist tokens in the operational IndexedDB.
  const auth = initializeAuth(app, { persistence: browserSessionPersistence })
  const db = initializeFirestore(app, { localCache: memoryLocalCache() })
  return {
    subscribe: (listener: (user: FirebaseIdentity | null) => void) => onAuthStateChanged(auth, user => listener(user ? { uid: user.uid, email: user.email } : null)),
    login: async (email: string, password: string) => { await signInWithEmailAndPassword(auth, email.trim(), password) },
    logout: () => signOut(auth),
    verify: async () => {
      const user = auth.currentUser
      if (!user) throw new Error('Inicia sesión para consultar tu acceso.')
      await user.getIdToken(true)
      const member = await getDocFromServer(doc(db, 'workspaces', workspaceId, 'members', user.uid))
      const workspace = await getDocFromServer(doc(db, 'workspaces', workspaceId))
      if (auth.currentUser !== user) throw new Error('La sesión cambió. Vuelve a consultar el acceso.')
      return parseAccess(member.data(), workspace.data())
    },
  }
}
let connection: ReturnType<typeof initializeConnection> | undefined
export function firebaseConnection() {
  if (connection === undefined) connection = initializeConnection()
  return connection
}
