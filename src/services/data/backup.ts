import { CATALOG_DB_VERSION, openCatalogDatabase } from '../catalogDatabase.ts'
import { assertNoPendingOperations, assertStoreSet, canonical, readData, snapshotToken, stores, type DataSnapshot } from './snapshot.ts'
import { validateData } from './backupValidation.ts'

export const BACKUP_FORMAT_VERSION = 1
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024
export interface BackupEnvelope { application: 'MATU ART'; formatVersion: number; databaseVersion: number; generatedAt: string; counts: Record<string, number>; data: Record<string, unknown[]>; sha256: string }
export const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('')
async function encode(data: DataSnapshot): Promise<BackupEnvelope['data']> {
  const rows = JSON.parse(JSON.stringify(data)) as BackupEnvelope['data']
  rows.products = await Promise.all(data.products.map(async product => {
    if(!product.image) return product
    const bytes = new Uint8Array(await product.image.arrayBuffer())
    let binary = ''; for(let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768))
    return {...product,image:{encoding:'base64',mime:product.image.type,bytes:bytes.length,data:btoa(binary)}}
  }))
  return rows
}
export async function createBackup(data: DataSnapshot): Promise<string> {
  validateData(data); assertNoPendingOperations(data)
  if(data.products.reduce((n,p)=>n+(p.image?.size??0),0)>MAX_BACKUP_BYTES/2) throw new Error('Las imágenes superan el límite de 64 MB por respaldo.')
  const body = {application:'MATU ART' as const,formatVersion:BACKUP_FORMAT_VERSION,databaseVersion:CATALOG_DB_VERSION,generatedAt:new Date().toISOString(),counts:Object.fromEntries(stores.map(s=>[s,data[s].length])),data:await encode(data)}
  const result = JSON.stringify({...body,sha256:await digest(canonical(body))})
  if(new Blob([result]).size>MAX_BACKUP_BYTES) throw new Error('El respaldo supera 128 MB. No se generó un archivo parcial.')
  await parseBackup(result)
  return result
}
function safeJSON(text: string): unknown {
  return JSON.parse(text,(key,value:unknown)=>{ if(['__proto__','constructor','prototype'].includes(key)) throw new Error('El archivo contiene claves no permitidas.'); return value })
}
export async function parseBackup(text: string): Promise<{data:DataSnapshot; generatedAt:string; counts:Record<string,number>}> {
  if(new Blob([text]).size>MAX_BACKUP_BYTES) throw new Error('El respaldo supera el límite de 128 MB.')
  const raw = safeJSON(text)
  if(!raw||typeof raw!=='object') throw new Error('El archivo no es un respaldo de MATU ART.')
  const envelope=raw as BackupEnvelope
  if(envelope.application!=='MATU ART'||envelope.formatVersion!==BACKUP_FORMAT_VERSION||![9,CATALOG_DB_VERSION].includes(envelope.databaseVersion)) throw new Error('Versión de respaldo incompatible. No se modificaron los datos. Se requiere un adaptador explícito para otra versión.')
  const {sha256,...body}=envelope
  if(!/^[a-f0-9]{64}$/.test(sha256??'')||await digest(canonical(body))!==sha256) throw new Error('La verificación SHA-256 falló: archivo incompleto o modificado.')
  if(!body.data||!body.counts||!Number.isFinite(Date.parse(body.generatedAt))) throw new Error('Faltan datos esenciales del respaldo.')
  // Explicit additive adapter: original v9 hash is checked before conversion.
  if(envelope.databaseVersion===9) {
    if('importRecords' in body.data)throw new Error('Respaldo v9 con estructura inesperada.');
    body.data.importRecords=[];body.counts.importRecords=0;
  }
  assertStoreSet(Object.keys(body.data))
  let count=0
  for(const store of stores) { if(!Array.isArray(body.data[store])||body.data[store].length!==body.counts[store]) throw new Error(`Cantidad inválida de registros: ${store}.`); count+=body.data[store].length }
  if(count>250_000) throw new Error('Este respaldo supera el límite de 250.000 registros.')
  for(const rawProduct of body.data.products) {
    if(!rawProduct||typeof rawProduct!=='object') throw new Error('Producto inválido.')
    const product=rawProduct as Record<string,unknown>
    if(product.image!==undefined) {
      const image=product.image as {encoding?:string;mime?:string;bytes?:number;data?:string}
      if(!image||image.encoding!=='base64'||typeof image.mime!=='string'||typeof image.data!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)||image.data.length>14*1024*1024) throw new Error('Imagen de respaldo inválida.')
      const binary=atob(image.data); if(binary.length!==image.bytes) throw new Error('Imagen incompleta.')
      const signature = image.mime==='image/png' ? binary.startsWith('\x89PNG\r\n\x1a\n') : image.mime==='image/jpeg' ? binary.startsWith('\xff\xd8\xff') : image.mime==='image/webp' ? binary.startsWith('RIFF')&&binary.slice(8,12)==='WEBP' : image.mime==='image/gif' ? /^GIF8[79]a/.test(binary) : false
      if(!signature) throw new Error('El contenido de una imagen no coincide con su formato.')
      product.image=new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:image.mime})
    }
  }
  validateData(body.data); assertNoPendingOperations(body.data)
  return {data:body.data,generatedAt:body.generatedAt,counts:body.counts}
}
/** Called only after explicit UI confirmation. All clears, writes and verification share one transaction. */
export async function restoreBackup(data: DataSnapshot, expectedLocalToken: string, name?: string) {
  validateData(data); assertNoPendingOperations(data)
  const db=await openCatalogDatabase(name)
  try {
    assertStoreSet(db.objectStoreNames)
    const tx=db.transaction([...stores],'readwrite'), done=tx.done; void done.catch(()=>{})
    try {
      const current=Object.fromEntries(await Promise.all(stores.map(async s=>[s,await tx.objectStore(s).getAll()]))) as DataSnapshot
      assertNoPendingOperations(current)
      if(snapshotToken(current)!==expectedLocalToken) throw new Error('Los datos locales cambiaron desde la vista previa. Valida el archivo de nuevo antes de restaurar.')
      for(const store of stores) {
        await tx.objectStore(store).clear()
        for(const record of data[store]) await tx.objectStore(store).add(record)
      }
      const restored=Object.fromEntries(await Promise.all(stores.map(async s=>[s,await tx.objectStore(s).getAll()]))) as DataSnapshot
      if(snapshotToken(restored)!==snapshotToken(data)) throw new Error('La verificación de restauración falló.')
      await done
    } catch(error) { try{tx.abort()}catch{/* already aborted */} await done.catch(()=>{}); throw error }
  } finally { db.close() }
}
export async function prepareRestore(text:string,name?:string) { const parsed=await parseBackup(text); const current=await readData(name); assertNoPendingOperations(current); return {...parsed,localToken:snapshotToken(current),localCounts:Object.fromEntries(stores.map(s=>[s,current[s].length]))} }
