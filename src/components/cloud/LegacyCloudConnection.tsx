import { useEffect, useRef, useState } from 'react'
import { Modal } from '../Modal'
import { CloudError, cloudBase, createCloudClient } from '../../services/cloud/client'
import type { CloudSession } from '../../services/cloud/contracts'

export function CloudConnection({onClose}:{onClose:()=>void}) {
  const [configuration] = useState(()=>{try{return {base:cloudBase(import.meta.env.VITE_CLOUD_API_URL ?? '',window.location.origin),error:''}}catch(error){return {base:'',error:error instanceof Error?error.message:'Configuración inválida'}}})
  const [client] = useState(()=>createCloudClient(configuration.base))
  const [session,setSession] = useState<CloudSession>()
  const [username,setUsername] = useState(''), [password,setPassword] = useState('')
  const [message,setMessage] = useState(''), [error,setError] = useState(configuration.error)
  const [busy,setBusy] = useState(false), [online,setOnline] = useState(navigator.onLine)
  const lock = useRef(false)
  useEffect(()=>{
    const update = ()=>{setOnline(navigator.onLine);setSession(undefined);setMessage('Vuelve a consultar la sesión cuando haya conexión.')}
    window.addEventListener('online',update);window.addEventListener('offline',update)
    const timer = window.setInterval(()=>setSession(current=>current && Date.parse(current.expiresAt)<=Date.now()?undefined:current),1000)
    return ()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);window.clearInterval(timer)}
  },[])
  async function run(action:()=>Promise<void>) {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setMessage('')
    try{await action()}catch(cause){if(cause instanceof CloudError && ['UNAUTHENTICATED','NETWORK'].includes(cause.code))setSession(undefined);setError(cause instanceof Error?cause.message:'No se pudo completar la solicitud.')}
    finally{lock.current=false;setBusy(false)}
  }
  return <Modal title="Conexión a la nube" onClose={onClose} busy={busy}>
    <div className="data-manager cloud-connection">
      <p className="local-note">Datos locales · Guardados en este navegador. La sincronización todavía no está habilitada.</p>
      {!configuration.base && <p>La conexión no está configurada. Puedes seguir trabajando con tus datos locales.</p>}
      {!online && <p className="stock-warning">Sin conexión. El punto de venta y el inventario local siguen disponibles.</p>}
      {configuration.base && <>
        <button type="button" className="button secondary" disabled={busy||!online} onClick={()=>void run(async()=>{await client.status();try{setSession(await client.session());setMessage('Sesión vigente. Los datos siguen siendo locales.')}catch(cause){if(cause instanceof CloudError && cause.code==='UNAUTHENTICATED'){setSession(undefined);setMessage('Servidor disponible. Inicia sesión para probar Google Sheets.')}else throw cause}})}>Consultar conexión y sesión</button>
        {session ? <>
          <p>Sesión: <strong>{session.user.username}</strong> · {{administrator:'Administrador',manager:'Encargado',seller:'Vendedor'}[session.user.role]}</p>
          {session.user.role!=='seller' && <button type="button" className="button primary" disabled={busy||!online} onClick={()=>void run(async()=>{const result=await client.test(session.csrf);setMessage(result.ready?'Conexión con Google Sheets verificada. No se enviaron datos locales.':'Google Sheets respondió; falta preparar la estructura de hojas. No se enviaron datos locales.')})}>Probar conexión con Google Sheets</button>}
          <button type="button" className="button secondary" disabled={busy||!online} onClick={()=>void run(async()=>{await client.logout(session.csrf);setSession(undefined);setMessage('Sesión cerrada. Tus datos locales se conservan.')})}>Cerrar sesión</button>
        </> : <form onSubmit={event=>{event.preventDefault();void run(async()=>{try{setSession(await client.login(username,password));setMessage('Sesión iniciada. La sincronización sigue deshabilitada.')}finally{setPassword('')}})}}>
          <label>Usuario<input autoComplete="username" value={username} maxLength={100} required disabled={busy||!online} onChange={event=>setUsername(event.target.value)} /></label>
          <label>Contraseña<input type="password" autoComplete="current-password" value={password} maxLength={256} required disabled={busy||!online} onChange={event=>setPassword(event.target.value)} /></label>
          <button className="button primary" disabled={busy||!online}>Iniciar sesión</button>
        </form>}
      </>}
      {busy && <p role="status">Conectando…</p>}{message && <p role="status">{message}</p>}{error && <p className="storage-error" role="alert">{error}</p>}
    </div>
  </Modal>
}
