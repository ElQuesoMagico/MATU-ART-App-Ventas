import { initializeApp } from 'firebase/app'
import { initializeAuth, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator } from 'firebase/auth'
import { initializeFirestore, memoryLocalCache, doc, getDocFromServer, connectFirestoreEmulator } from 'firebase/firestore'
import { parseAccess } from './access'
import { catalogRemote } from './catalogRemote'
import { configurationRemote } from './commercial/configurationRemote'
import { saleRemote } from './commercial/saleRemote'
import { inventoryRemote } from './commercial/inventoryRemote'
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
  if(import.meta.env.DEV && env.VITE_FIREBASE_EMULATORS==='true'){
    if(!options.projectId?.startsWith('demo-'))throw new Error('Los emuladores solo admiten proyectos demo-.')
    connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true})
    connectFirestoreEmulator(db,'127.0.0.1',8080)
  }
  return {
    workspaceId,
    commercialEnabled: env.VITE_FIREBASE_COMMERCIAL_ENABLED === 'true',
    commercialIdentity: () => env.VITE_FIREBASE_COMMERCIAL_ENABLED === 'true' && auth.currentUser ? { uid: auth.currentUser.uid, workspaceId } : undefined,
    commercial: () => {
      if(env.VITE_FIREBASE_COMMERCIAL_ENABLED !== 'true'||!auth.currentUser)throw new Error('Operación comercial no habilitada o sesión cerrada.')
      return { configuration: configurationRemote(db,workspaceId,auth.currentUser.uid), sales:saleRemote(db,workspaceId,auth.currentUser.uid) }
    },
    inventoryEnabled: env.VITE_FIREBASE_INVENTORY_ENABLED === 'true',
    identity: () => auth.currentUser?.uid,
    inventory: () => {
      if (env.VITE_FIREBASE_INVENTORY_ENABLED !== 'true' || !auth.currentUser) throw new Error('Inventario compartido no habilitado o sesión cerrada.')
      return inventoryRemote(db, workspaceId, auth.currentUser.uid)
    },
    catalogEnabled: env.VITE_FIREBASE_CATALOG_ENABLED === 'true',
    inspectCatalog: async () => {
      const user = auth.currentUser
      if (!user) throw new Error('Inicia sesión para consultar el catálogo.')
      await user.getIdToken(true)
      // Read-only diagnostic: no local repository, linking, listener or queue.
      const records = await catalogRemote(db, workspaceId, user.uid).read()
      if (auth.currentUser !== user) throw new Error('La sesión cambió. Vuelve a consultar el catálogo.')
      const counts = { categories: 0, families: 0, ips: 0, products: 0 }
      for (const record of Object.values(records)) if(!record.deleted) counts[record.payload.entity]++
      return counts
    },
    catalog: () => {
      if(env.VITE_FIREBASE_CATALOG_ENABLED !== 'true'||!auth.currentUser)throw new Error('Sincronización de catálogo no activada.')
      return catalogRemote(db,workspaceId,auth.currentUser.uid)
    },
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
