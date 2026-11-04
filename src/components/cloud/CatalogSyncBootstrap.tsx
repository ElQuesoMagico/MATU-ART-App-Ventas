import { useEffect } from 'react'
import { firebaseConnection } from '../../services/firebase/client'
import { startCatalog, stopCatalog, startOfflineCatalog, reportCatalogError } from '../../services/firebase/catalogRuntime'
import { firebaseMessage } from '../../services/firebase/access'
export function CatalogSyncBootstrap(){
  useEffect(()=>{
    let valid=true,sequence=0,verifying=false,retry=false
    let client
    try{client=firebaseConnection()}catch{return}
    if(!client?.catalogEnabled)return
    let identity:string|undefined
    const connect=()=>{
      if(verifying)return
      const current=++sequence
      if(!identity){stopCatalog();return}
      const uid=identity
      if(!navigator.onLine){startOfflineCatalog(uid);return}
      verifying=true
      void client.verify().then(access=>{if(valid&&current===sequence){retry=false;return startCatalog(uid,access.role)}}).catch(cause=>{
        if(valid&&current===sequence){stopCatalog();reportCatalogError(firebaseMessage(cause));retry=true}
      }).finally(()=>{verifying=false})
    }
    const unsubscribe=client.subscribe(user=>{sequence++;identity=user?.uid;stopCatalog();verifying=false;connect()})
    window.addEventListener('online',connect)
    const timer=window.setInterval(()=>{if(retry&&navigator.onLine)connect()},30000)
    return ()=>{valid=false;clearInterval(timer);unsubscribe();window.removeEventListener('online',connect);stopCatalog()}
  },[])
  return null
}
