import { collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, onSnapshot, getDocFromServer } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { kinds, keyOf, payloadSchema, stable, remoteSchema, references } from './catalogModel.ts'
import type { RemoteRecord, Pending } from './catalogModel.ts'
export function catalogRemote(db:Firestore,workspaceId:string,uid:string){
  const root=`workspaces/${workspaceId}`
  return {
    watch(update:(records:Record<string,RemoteRecord>)=>void,error:(error:Error)=>void){
      const buckets=new Map<string,Record<string,RemoteRecord>>()
      let previous=''
      const subscriptions=kinds.map(kind=>onSnapshot(query(collection(db,`${root}/${kind}`),limit(2001)),{includeMetadataChanges:true},snapshot=>{
        if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return
        try {
          if(snapshot.size>2000)throw new Error('Más de 2.000 registros por tipo: se requiere paginación.')
          const records:Record<string,RemoteRecord>={}
          for(const row of snapshot.docs){const v=row.data(),p=payloadSchema.parse(v.payload);if(p.entity!==kind||p.id!==row.id||!Number.isSafeInteger(v.revision)||v.revision<1)throw new Error('Registro cloud inválido.');records[keyOf(p)]=remoteSchema.parse({payload:p,revision:v.revision,operationId:v.operationId,...(v.deleted?{deleted:v.deleted}:{})})}
          buckets.set(kind,records)
          if(buckets.size===kinds.length){
            const combined:Record<string,RemoteRecord>=Object.assign({},...buckets.values())
            const fingerprint=stable(combined)
            if(fingerprint!==previous){previous=fingerprint;update(combined)}
          }
        }catch(cause){error(cause instanceof Error?cause:new Error('Catálogo inválido.'))}
      },error))
      return ()=>subscriptions.forEach(stop=>stop())
    },
    async read():Promise<Record<string,RemoteRecord>>{
      const result:Record<string,RemoteRecord>={}
      for(const kind of kinds){const snapshot=await getDocs(query(collection(db,`${root}/${kind}`),limit(2001)))
        if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)throw new Error('No se pudo confirmar el catálogo con el servidor.')
        if(snapshot.size>2000)throw new Error('El catálogo supera el límite de 2.000 registros por tipo. Se requiere paginación antes de continuar.')
        for(const row of snapshot.docs){const value=row.data();const p=payloadSchema.parse(value.payload)
          if(p.entity!==kind||p.id!==row.id||!Number.isSafeInteger(value.revision)||value.revision<1)throw new Error('Registro cloud inválido.')
          result[keyOf(p)]=remoteSchema.parse({payload:p,revision:value.revision,operationId:value.operationId,...(value.deleted?{deleted:value.deleted}:{})})
        }
      }
      return result
    },
    async deletionSnapshot(){
      const before=await getDocFromServer(doc(db,`${root}/catalogControl/revision`))
      const records=await this.read()
      const configuration=await getDocFromServer(doc(db,`${root}/commercialConfiguration/current`))
      const after=await getDocFromServer(doc(db,`${root}/catalogControl/revision`))
      if((before.data()?.revision??0)!==(after.data()?.revision??0))throw new Error('El catálogo cambió. Repite la revisión.')
      return {records,epoch:after.data()?.revision??0,configuration:configuration.data()??null}
    },
    async remove(key:string,expectedRevision:number,epoch:number,operationId:string,deviceId:string,configurationToken:string):Promise<RemoteRecord>{
      const [entity,id]=key.split('/')
      if(!kinds.includes(entity as typeof kinds[number])||!id)throw new Error('Registro inválido.')
      const snapshot=await this.deletionSnapshot()
      const existing=snapshot.records[key]
      // An acknowledged retry is checked by its immutable receipt inside the transaction.
      if(!existing?.deleted){
        if(snapshot.epoch!==epoch)throw new Error('El catálogo cambió. Revisa de nuevo antes de eliminar.')
        const dependents=Object.values(snapshot.records).filter(r=>!r.deleted&&references(r.payload).includes(key))
        if(dependents.length)throw new Error(`${dependents.length} productos asociados. Reasígnalos antes de eliminar.`)
        const related=(value:unknown):boolean=>value===id||Array.isArray(value)&&value.some(related)||!!value&&typeof value==='object'&&Object.values(value).some(related)
        if(related(snapshot.configuration))throw new Error('Existen condiciones comerciales asociadas. Revisa promociones, packs y precios por evento.')
      }
      return runTransaction(db,async tx=>{
        const ref=doc(db,`${root}/${key}`), receipt=doc(db,`${root}/catalogOperations/${operationId}`), gate=doc(db,`${root}/catalogControl/revision`)
        const [old,current,control,config]=await Promise.all([tx.get(receipt),tx.get(ref),tx.get(gate),tx.get(doc(db,`${root}/commercialConfiguration/current`))])
        if(old.exists()){
          const record=remoteSchema.parse(old.data().record)
          if(!record.deleted||old.data().actorUid!==uid||old.data().deviceId!==deviceId||keyOf(record.payload)!==key)throw new Error('Operación ya utilizada.')
          return record
        }
        if(!current.exists()||current.data().deleted)throw new Error('El registro ya fue eliminado.')
        if(current.data().revision!==expectedRevision||(control.data()?.revision??0)!==epoch||stable(config.data()??null)!==configurationToken)throw new Error('El catálogo cambió. Revisa de nuevo antes de eliminar.')
        let inventory
        if(entity==='products'){
          inventory=await tx.get(doc(db,`${root}/inventory/${id}`))
          if(inventory.exists()&&inventory.data().balance.stock!==0)throw new Error('El producto conserva existencias compartidas. Realiza un conteo o ajuste antes de eliminar.')
        }
        const record:RemoteRecord={payload:payloadSchema.parse(current.data().payload),revision:expectedRevision+1,operationId,deleted:{at:new Date().toISOString(),by:uid}}
        tx.set(gate,{revision:epoch+1,operationId,entity,id})
        tx.set(ref,{...record,actorUid:uid,confirmedAt:serverTimestamp()})
        tx.set(receipt,{record,actorUid:uid,deviceId,confirmedAt:serverTimestamp()})
        if(inventory?.exists())tx.set(inventory.ref,{...inventory.data(),deleted:true,confirmedAt:serverTimestamp()})
        return record
      })
    },
    async commit(pending:Pending,deviceId:string):Promise<RemoteRecord>{
      const payload=payloadSchema.parse(pending.payload),key=keyOf(payload)
      if(payload.name.includes('/'))throw new Error('Los nombres con / requieren corregirse antes de sincronizar.')
      const ref=doc(db,`${root}/${key}`),receipt=doc(db,`${root}/catalogOperations/${pending.id}`)
      return runTransaction(db,async tx=>{
        const epochRef=doc(db,`${root}/catalogControl/revision`)
        const [op,previous,epoch]=await Promise.all([tx.get(receipt),tx.get(ref),tx.get(epochRef)])
        if(op.exists()){
          const value=op.data()
          if(value.actorUid!==uid||value.deviceId!==deviceId||stable(value.record.payload)!==stable(payload)||value.record.revision!==pending.expectedRevision+1)throw new Error('Identificador de operación ya utilizado.')
          return value.record as RemoteRecord
        }
        if(previous.data()?.deleted)throw new Error('CONFLICT: este registro fue eliminado en otro dispositivo. No se puede restaurar.')
        if((previous.data()?.revision??0)!==pending.expectedRevision)throw new Error('CONFLICT: el registro cambió en otro dispositivo.')
        const nameId=`${payload.entity}_${payload.name.toLowerCase()}`,nameRef=doc(db,`${root}/catalogNames/${nameId}`)
        const reservation=await tx.get(nameRef)
        if(reservation.exists()&&(reservation.data().entity!==payload.entity||reservation.data().id!==payload.id))throw new Error('CONFLICT: nombre utilizado por otro UUID. Resuelve la coincidencia sin recrear productos.')
        const record={payload,revision:pending.expectedRevision+1,operationId:pending.id}
        tx.set(epochRef,{revision:(epoch.data()?.revision??0)+1,operationId:pending.id,entity:payload.entity,id:payload.id})
        tx.set(ref,{...record,actorUid:uid,confirmedAt:serverTimestamp()})
        tx.set(receipt,{record,actorUid:uid,deviceId,confirmedAt:serverTimestamp()})
        tx.set(nameRef,{entity:payload.entity,id:payload.id})
        const old=previous.data()?.payload
        if(old&&old.name.toLowerCase()!==payload.name.toLowerCase())tx.delete(doc(db,`${root}/catalogNames/${old.entity}_${old.name.toLowerCase()}`))
        return record
      })
    },
  }
}
