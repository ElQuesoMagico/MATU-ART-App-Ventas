import { useEffect, useRef, useState } from 'react'
import { Modal } from '../Modal'
import { firebaseConnection } from '../../services/firebase/client'
import type { FirebaseIdentity } from '../../services/firebase/client'
import { firebaseMessage } from '../../services/firebase/access'
import type { VerifiedAccess } from '../../services/firebase/access'
import { CatalogSyncPanel } from './CatalogSyncPanel'

export function CloudConnection({ onClose, offerLocal = false }: { onClose: () => void; offerLocal?: boolean }) {
  const [configuration] = useState(() => {
    try { return { client: firebaseConnection(), error: '' } }
    catch (error) { return { client: null, error: firebaseMessage(error) } }
  })
  const { client } = configuration
  const [user, setUser] = useState<FirebaseIdentity | null>(null)
  const [access, setAccess] = useState<VerifiedAccess>()
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [error, setError] = useState(configuration.error), [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false), [online, setOnline] = useState(navigator.onLine)
  const lock = useRef(false), revision = useRef(0), mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    const invalidate = () => { revision.current++ }
    const unsubscribe = client?.subscribe(identity => { revision.current++; setUser(identity); setAccess(undefined) })
    const update = () => { revision.current++; setOnline(navigator.onLine); setAccess(undefined); setMessage('') }
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { mounted.current = false; invalidate(); unsubscribe?.(); window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [client])
  useEffect(() => {
    if (!client || !user || !online) return
    let active = true
    const current = revision.current
    void client.verify().then(result => {
      if (active && current === revision.current) { setAccess(result); setError(''); setMessage('Acceso verificado con Firestore.') }
    }).catch(cause => { if (active && current === revision.current) setError(firebaseMessage(cause)) })
    return () => { active = false }
  }, [client, user, online])
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage(''); setAccess(undefined)
    try { await action() } catch (cause) { if (mounted.current) setError(firebaseMessage(cause)) }
    finally { lock.current = false; if (mounted.current) { setBusy(false); setPassword('') } }
  }
  async function verify() {
    const current = revision.current
    const result = await client!.verify()
    if (mounted.current && current === revision.current && navigator.onLine) {
      setAccess(result); setMessage('Acceso verificado con Firestore.')
    }
  }
  async function inspectCatalog() {
    const current = revision.current
    const result = await client!.verify()
    const counts = await client!.inspectCatalog()
    if (mounted.current && current === revision.current && navigator.onLine) {
      setAccess(result)
      setMessage(`Lectura del catálogo verificada con Firestore: ${counts.products} productos, ${counts.categories} categorías, ${counts.families} familias y ${counts.ips} IPs. Esta comprobación no subió ni modificó datos.`)
    }
  }
  return <Modal title={user ? 'Mi cuenta' : 'Iniciar sesión'} onClose={onClose} busy={busy}>
    <div className="data-manager cloud-connection">
      <p className="local-note">{client?.catalogEnabled?'Ventas, stock y costos locales. Consulta el estado del catálogo más abajo.':'Datos locales · La sincronización todavía no está habilitada.'}</p>
      {!client && !error && <p>Firebase no está configurado. Puedes seguir trabajando con tus datos locales.</p>}
      {!online && <p className="stock-warning">Sin conexión. El POS y el inventario local siguen disponibles.</p>}
      {client && (user ? <>
        <p>Cuenta: <strong>{user.email ?? user.uid}</strong></p>
        {access ? <p>{access.workspaceName} · {{ administrator: 'Administrador', manager: 'Encargado', seller: 'Vendedor' }[access.role]}<br /><small>Última verificación: {new Date(access.verifiedAt).toLocaleTimeString('es-CL')}</small></p> : <p>Acceso al espacio pendiente de verificación.</p>}
        <button type="button" className="button primary" disabled={busy || !online} onClick={() => void run(verify)}>Verificar acceso</button>
        <button type="button" className="button secondary" disabled={busy || !online} onClick={() => void run(inspectCatalog)}>Comprobar lectura del catálogo</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { revision.current++; await client.logout(); if (mounted.current) setMessage('Sesión cerrada. Tus datos locales se conservan.') })}>Cerrar sesión</button>
        {access&&<CatalogSyncPanel uid={user.uid} role={access.role} />}
      </> : <form onSubmit={event => { event.preventDefault(); void run(async () => { await client.login(email, password); if (mounted.current) setMessage('Sesión iniciada. Pulsa Verificar acceso para comprobar tu membresía.') }) }}>
        <label>Correo electrónico<input type="email" autoComplete="username" value={email} required disabled={busy || !online} onChange={event => setEmail(event.target.value)} /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={password} required disabled={busy || !online} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit" className="button primary" disabled={busy || !online}>Iniciar sesión</button>
      </form>)}
      {offerLocal && !user && <><p className="local-note">Inicia sesión para compartir el catálogo entre dispositivos. Sin sesión, los cambios permanecen en este navegador.</p><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Continuar sin conexión a la nube</button></>}
      {busy && <p role="status">Conectando…</p>}{message && <p role="status">{message}</p>}{error && <p className="storage-error" role="alert">{error}</p>}
    </div>
  </Modal>
}
