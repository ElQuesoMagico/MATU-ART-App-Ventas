import { useEffect, useRef, useState } from 'react'
import { firebaseConnection, type FirebaseIdentity } from '../../services/firebase/client'
import { catalogStatus } from '../../services/firebase/catalogRuntime'
import { openCatalogDatabase } from '../../services/catalogDatabase'
import { CloudConnection } from './CloudConnection'

/** Account visibility never grants permissions or changes operational data. */
export function AccountAccess() {
  const [client] = useState(() => { try { return firebaseConnection() } catch { return null } })
  const [user, setUser] = useState<FirebaseIdentity | null>(null)
  const [ready, setReady] = useState(false), [online, setOnline] = useState(navigator.onLine)
  const [open, setOpen] = useState(false), [status, setStatus] = useState('Datos locales')
  const dismissed = useRef(false)
  useEffect(() => {
    const unsubscribe = client?.subscribe(identity => { setUser(identity); setReady(true) })
    const network = () => setOnline(navigator.onLine)
    window.addEventListener('online', network); window.addEventListener('offline', network)
    return () => { unsubscribe?.(); window.removeEventListener('online', network); window.removeEventListener('offline', network) }
  }, [client])
  useEffect(() => {
    if (client && ready && online && !user && !dismissed.current) setOpen(true)
  }, [client, ready, online, user])
  useEffect(() => {
    let active = true
    const refresh = async () => {
      let text = !online ? 'Sin Internet · Datos locales' : !user ? 'Sin sesión · Catálogo sin sincronizar' : 'Catálogo sin vincular'
      if (user && online) {
        try {
          const db = await openCatalogDatabase()
          const state = await db.get('catalogSync', 'catalog'); db.close()
          const runtime = catalogStatus()
          const pending = Object.keys(state?.pending ?? {}).length
          const conflicts = Object.keys(state?.conflicts ?? {}).length
          text = runtime.error ? 'Error de conexión · Revisar' : conflicts ? `${conflicts} conflictos · Revisar` : pending ? `${pending} cambios pendientes` : runtime.automatic && runtime.remote ? 'Catálogo conectado' : state ? 'Verificando conexión del catálogo' : text
        } catch { text = 'No se pudo consultar el estado local' }
      }
      if (active) setStatus(text)
    }
    void refresh(); const timer = setInterval(() => void refresh(), 3000)
    return () => { active = false; clearInterval(timer) }
  }, [user, online])
  if (!client) return <span className="demo-tag">Datos locales</span>
  const close = () => { dismissed.current = true; setOpen(false) }
  return <div className="account-access">
    <button type="button" className="button secondary account-button" onClick={() => setOpen(true)} aria-label={user ? `Mi cuenta: ${user.email ?? 'Usuario'}` : 'Iniciar sesión'}>{user ? 'Mi cuenta' : 'Iniciar sesión'}</button>
    <span className="account-status" role="status">{status}</span>
    {open && <CloudConnection onClose={close} offerLocal />}
  </div>
}
