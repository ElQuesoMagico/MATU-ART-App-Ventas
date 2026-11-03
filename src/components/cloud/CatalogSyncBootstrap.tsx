import { useEffect } from 'react'
import { firebaseConnection } from '../../services/firebase/client'
import { startCatalog, stopCatalog, startOfflineCatalog } from '../../services/firebase/catalogRuntime'
export function CatalogSyncBootstrap(){
  useEffect(()=>{
    let valid=true,sequence=0
    let client
    try{client=firebaseConnection()}catch{return}
    if(!client?.catalogEnabled)return
    let identity:string|undefined
    const connect=()=>{
      const current=++sequence;stopCatalog()
      if(!identity)return
      const uid=identity
      if(!navigator.onLine){startOfflineCatalog(uid);return}
      void client.verify().then(access=>{if(valid&&current===sequence)return startCatalog(uid,access.role)}).catch(()=>{if(valid&&current===sequence)stopCatalog()})
    }
    const unsubscribe=client.subscribe(user=>{identity=user?.uid;connect()})
    window.addEventListener('online',connect)
    return ()=>{valid=false;unsubscribe();window.removeEventListener('online',connect);stopCatalog()}
  },[])
  return null
}
