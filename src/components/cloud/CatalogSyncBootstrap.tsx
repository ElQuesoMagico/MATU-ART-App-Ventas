import { startCommercial, stopCommercial } from '../../services/firebase/commercial/commercialRuntime'
import { useEffect } from 'react'
import { firebaseConnection } from '../../services/firebase/client'
import { startCatalog, stopCatalog, startOfflineCatalog, reportCatalogError } from '../../services/firebase/catalogRuntime'
import { firebaseMessage } from '../../services/firebase/access'
import { startInventory, stopInventory } from '../../services/firebase/commercial/inventoryRuntime'
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
      if(!identity){stopCatalog();stopInventory();stopCommercial();return}
      const uid=identity
      if(!navigator.onLine){startOfflineCatalog(uid);return}
      verifying=true
      void client.verify().then(access=>{if(valid&&current===sequence){retry=false;startInventory(uid,access.role);startCommercial(uid,access.role);return startCatalog(uid,access.role)}}).catch(cause=>{
        if(valid&&current===sequence){stopCatalog();stopInventory();stopCommercial();reportCatalogError(firebaseMessage(cause));retry=true}
      }).finally(()=>{verifying=false})
    }
    const unsubscribe=client.subscribe(user=>{sequence++;identity=user?.uid;stopCatalog();stopInventory();stopCommercial();verifying=false;connect()})
    window.addEventListener('online',connect)
    const timer=window.setInterval(()=>{if(retry&&navigator.onLine)connect()},30000)
    return ()=>{valid=false;clearInterval(timer);unsubscribe();window.removeEventListener('online',connect);stopCatalog();stopInventory();stopCommercial()}
  },[])
  return null
}
