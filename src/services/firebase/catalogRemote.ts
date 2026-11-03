import { collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, onSnapshot } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { kinds, keyOf, payloadSchema, stable } from './catalogModel.ts'
import type { RemoteRecord, Pending } from './catalogModel.ts'
export function catalogRemote(db:Firestore,workspaceId:string,uid:string){
  const root=`workspaces/${workspaceId}`
  return {
    watch(update:(records:Record<string,RemoteRecord>)=>void,error:(error:Error)=>void){
      const buckets=new Map<string,Record<string,RemoteRecord>>()
      const subscriptions=kinds.map(kind=>onSnapshot(query(collection(db,`${root}/${kind}`),limit(2001)),{includeMetadataChanges:true},snapshot=>{
        if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return
        try {
          if(snapshot.size>2000)throw new Error('Más de 2.000 registros por tipo: se requiere paginación.')
          const records:Record<string,RemoteRecord>={}
          for(const row of snapshot.docs){const v=row.data(),p=payloadSchema.parse(v.payload);if(p.entity!==kind||p.id!==row.id)throw new Error('Registro cloud inválido.');records[keyOf(p)]={payload:p,revision:v.revision,operationId:v.operationId}}
          buckets.set(kind,records)
          if(buckets.size===kinds.length)update(Object.assign({},...buckets.values()))
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
          result[keyOf(p)]={payload:p,revision:value.revision,operationId:value.operationId}
        }
      }
      return result
    },
    async commit(pending:Pending,deviceId:string):Promise<RemoteRecord>{
      const payload=payloadSchema.parse(pending.payload),key=keyOf(payload)
      if(payload.name.includes('/'))throw new Error('Los nombres con / requieren corregirse antes de sincronizar.')
      const ref=doc(db,`${root}/${key}`),receipt=doc(db,`${root}/catalogOperations/${pending.id}`)
      return runTransaction(db,async tx=>{
        const [op,previous]=await Promise.all([tx.get(receipt),tx.get(ref)])
        if(op.exists()){
          const value=op.data()
          if(value.actorUid!==uid||value.deviceId!==deviceId||stable(value.record.payload)!==stable(payload)||value.record.revision!==pending.expectedRevision+1)throw new Error('Identificador de operación ya utilizado.')
          return value.record as RemoteRecord
        }
        if((previous.data()?.revision??0)!==pending.expectedRevision)throw new Error('CONFLICT: el registro cambió en otro dispositivo.')
        const nameId=`${payload.entity}_${payload.name.toLowerCase()}`,nameRef=doc(db,`${root}/catalogNames/${nameId}`)
        const reservation=await tx.get(nameRef)
        if(reservation.exists()&&(reservation.data().entity!==payload.entity||reservation.data().id!==payload.id))throw new Error('CONFLICT: nombre utilizado por otro UUID. Resuelve la coincidencia sin recrear productos.')
        const record={payload,revision:pending.expectedRevision+1,operationId:pending.id}
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
