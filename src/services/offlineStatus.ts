import { useSyncExternalStore } from 'react'
let status = 'Preparando recursos sin conexión…'
const listeners=new Set<()=>void>()
function publish(message:string) {status=message;listeners.forEach(listener=>listener())}
export function startOfflineCache() {
  if(!import.meta.env.PROD) {publish('La caché sin conexión se prepara en la compilación de producción.');return}
  if(!('serviceWorker' in navigator)) {publish('Este navegador no permite preparar la recarga sin conexión. Los datos locales se conservan.');return}
  const hadController=!!navigator.serviceWorker.controller
  let changed=false
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    changed=true
    publish(hadController?'Actualización lista para aplicar automáticamente.':'Recursos de la aplicación disponibles sin conexión en este navegador.')
  })
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{updateViaCache:'none'}).then(result=>{
    const track=()=>{const worker=result.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='redundant')publish('No se pudo descargar la actualización. Se conserva la versión actual.')})}
    track();result.addEventListener('updatefound',track)
    void navigator.serviceWorker.ready.then(()=>{if(!changed)publish('Recursos de la aplicación disponibles sin conexión en este navegador.')})
    const check=()=>{if(navigator.onLine&&document.visibilityState==='visible')void result.update().catch(()=>{})}
    window.addEventListener('online',check)
    document.addEventListener('visibilitychange',check)
    window.setInterval(check,60000)
  }).catch(()=>publish('El navegador no permitió guardar los recursos sin conexión. Revisa permisos y vuelve a cargar.'))
}
export function useOfflineStatus() {return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},()=>status)}
