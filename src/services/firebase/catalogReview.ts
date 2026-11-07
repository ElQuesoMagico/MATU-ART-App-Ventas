import type {LocalView} from './catalogLocal.ts'
import type {Payload,RemoteRecord,SyncState} from './catalogModel.ts'
import {stable} from './catalogModel.ts'
import type {InclusionChoice,InclusionEntry} from './catalogInclusion.ts'
import {normalizedName} from '../catalogValidation.ts'

export const reviewTypes={products:'Producto',categories:'Categoría',families:'Familia',ips:'IP'}
export const elementCount=(count:number)=>`${count} ${count===1?'elemento':'elementos'}`
export function reviewRows(local:LocalView,remote:Record<string,RemoteRecord>){
 return (local.state?.excluded??[]).map(key=>{
  const here=local.records[key],there=remote[key]?.payload,p=here??there
  const candidates=[...Object.entries(remote),...Object.entries(local.records).map(([other,payload])=>[other,{payload,revision:0,operationId:''}] as const)]
  const similar=[...new Map(candidates.filter(([other,r])=>other!==key&&p&&r.payload.entity===p.entity&&normalizedName(r.payload.name).replace(/^sticker\s+/,'')===normalizedName(p.name).replace(/^sticker\s+/,''))).entries()]
  const different=!!here&&!!there&&stable(here)!==stable(there)
  const test=/\b(test|prueba|demo|qa)\b/i.test(p?.name??'')
  return {key,here,there,name:p?.name??'Elemento que necesita corrección',type:p?reviewTypes[p.entity]:'Elemento',similar,different,test,
   safe:!!p&&!local.invalid[key]&&!different&&!test&&!similar.length,
   reason:!p?'Hay información incompleta. Revisa este elemento desde Inventario antes de compartirlo.':similar.length?'Encontramos otro elemento parecido. Revisa si se trata del mismo antes de compartirlo.':different?'Encontramos cambios diferentes.':here&&there?'Coincide con los demás dispositivos, pero aquí no recibe futuras actualizaciones.':here?'Solo disponible en este dispositivo.':'Disponible en otros dispositivos, pero todavía no en este.'}
 })
}
export function reviewDifferences(here:Payload|undefined,there:Payload|undefined,local:LocalView,remote:Record<string,RemoteRecord>){
 const labels:Record<string,string>={name:'Nombre',price:'Precio',description:'Descripción',categoryId:'Categoría',familyIds:'Familias',ipIds:'IPs',isArchived:'Estado',isActive:'Estado',isFavorite:'Destacado',kind:'Tipo de producto',order:'Orden'}
 const display=(p:Payload|undefined,field:string,side:'here'|'there')=>{
  const value=p?.[field as keyof Payload] as unknown
  if(value===undefined)return 'No disponible'
  if(field==='price')return `$${Number(value).toLocaleString('es-CL')}`
  if(field==='isArchived')return value?'Archivado':'Activo'
  if(field==='isActive')return value?'Activo':'Archivado'
  if(field==='isFavorite')return value?'Sí':'No'
  if(field==='kind')return value==='pack'?'Pack físico':'Producto'
  if(['categoryId','familyIds','ipIds'].includes(field)){
   const kind=field==='categoryId'?'categories':field==='familyIds'?'families':'ips'
   const values=Array.isArray(value)?value:[value]
   return values.map(id=>side==='here'?local.records[`${kind}/${id}`]?.name??'Clasificación pendiente':remote[`${kind}/${id}`]?.payload.name??'Clasificación pendiente').join(', ')||'Ninguna'
  }
  return field==='description'&&!value?'Sin descripción':String(value)
 }
 return Object.entries(labels).filter(([field])=>{
  const a=(here as unknown as Record<string,unknown>)?.[field],b=(there as unknown as Record<string,unknown>)?.[field]
  return (a!==undefined||b!==undefined)&&(stable(a)!==stable(b)||!here||!there)
 }).map(([field,label])=>({field,label,here:display(here,field,'here'),there:display(there,field,'there')}))
}
export function bulkReviewChoices(rows:ReturnType<typeof reviewRows>,selected:string[],current:Record<string,InclusionChoice>){
 const result={...current}
 for(const row of rows)if(selected.includes(row.key)&&row.safe)result[row.key]=row.there?'remote':'local'
 return result
}
export function reviewError(error:unknown){
 const detail=error instanceof Error?error.message:String(error),code=typeof error==='object'&&error&&'code' in error?String(error.code):''
 if(/permission|Vendedor|cuenta|espacio/i.test(`${code} ${detail}`))return 'Tu cuenta no puede realizar este cambio. Verifica el acceso o pide ayuda a una persona administradora.'
 if(/network|unavailable|conexión|offline/i.test(`${code} ${detail}`))return 'No hay conexión disponible. Tus datos están guardados; vuelve a intentarlo cuando regrese Internet.'
 if(/cambió|excluido|CONFLICT/i.test(detail))return 'Los datos cambiaron mientras los revisabas. Vuelve a comparar antes de confirmar; no se aplicaron estas decisiones.'
 if(/UUID|coincide/i.test(detail))return 'Hay dos elementos con el mismo nombre. Revisa sus datos y corrige el nombre desde Inventario antes de compartirlos. No los fusionaremos automáticamente.'
 if(/clasificación|difiere|pendientes|conflictos/i.test(detail))return 'Revisa también las categorías, familias o IPs relacionadas. Algunas necesitan que elijas qué cambios mantener.'
 return 'No pudimos completar este paso. Tus datos no se borraron. Puedes volver a intentarlo; si continúa, consulta Información técnica.'
}
export function reviewOutcome(entries:InclusionEntry[],state:SyncState|undefined){
 let done=0,pending=0,failed=0
 for(const entry of entries){
  if(state?.conflicts[entry.key])failed++
  else if(state?.pending[entry.key]||state?.excluded.includes(entry.key)||!state?.baseline[entry.key]||stable(state.baseline[entry.key].payload)!==stable(entry.payload))pending++
  else done++
 }
 return {done,pending,failed}
}
