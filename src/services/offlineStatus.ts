import { useSyncExternalStore } from 'react'
let status = 'Preparando recursos sin conexión…'
const listeners=new Set<()=>void>()
function publish(message:string) {status=message;listeners.forEach(listener=>listener())}
export function startOfflineCache() {
  if(!import.meta.env.PROD) {publish('La caché sin conexión se prepara en la compilación de producción.');return}
  if(!('serviceWorker' in navigator)) {publish('Este navegador no permite preparar la recarga sin conexión. Los datos locales se conservan.');return}
  let registration:ServiceWorkerRegistration|undefined
  const ready=()=>{if(registration?.waiting)publish('Actualización descargada. Cierra las pestañas de MATU ART y vuelve a abrir para usarla sin conexión.');else if(navigator.serviceWorker.controller)publish('Recursos de la aplicación disponibles sin conexión en este navegador.')}
  navigator.serviceWorker.addEventListener('controllerchange',ready)
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(result=>{
    registration=result
    ready()
    if(registration.waiting)publish('Actualización descargada. Cierra las pestañas de MATU ART y vuelve a abrir para usarla sin conexión.')
    const track=()=>{const worker=result.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='redundant')publish('No se pudo preparar la caché sin conexión. Revisa espacio y conexión y recarga.');else if(worker.state==='installed'&&result.waiting)publish('Actualización descargada. Cierra las pestañas de MATU ART y vuelve a abrir.')})}
    track();registration.addEventListener('updatefound',track)
    void navigator.serviceWorker.ready.then(ready)
  }).catch(()=>publish('El navegador no permitió guardar los recursos sin conexión. Revisa permisos y vuelve a cargar.'))
}
export function useOfflineStatus() {return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},()=>status)}
