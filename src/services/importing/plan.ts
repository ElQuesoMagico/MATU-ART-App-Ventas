import type { ImportSource, ImportRecord } from '../../types/imports.ts'
import type { CatalogProduct } from '../../types/catalog.ts'
import type { StoredSale } from '../../types/sales.ts'
import { normalizedName } from '../catalogValidation.ts'
import { emptySnapshot, snapshotToken, type DataSnapshot } from '../data/snapshot.ts'
import { amount, categoryFor, chileanInstant } from './parse.ts'

export interface ReviewIssue {key:string;message:string;options?:{id:string;label:string}[];text?:boolean}
export interface ImportPlan {baseToken:string;batchId:string;additions:DataSnapshot;issues:ReviewIssue[];warnings:string[];alreadyImported:number;income:number;units:number;sourceRows:number;deferredRows:number;nextNumber:number}
export type ImportChoices=Record<string,string>
export function buildImportPlan(data:DataSnapshot,sources:ImportSource[],choices:ImportChoices={},identities:Record<string,string>={}):ImportPlan {
  const uid=(key:string)=>identities[key]??(identities[key]=crypto.randomUUID())
  const additions=emptySnapshot(), batchId=uid('batch'), now=new Date().toISOString()
  const plan:ImportPlan={baseToken:snapshotToken(data),batchId,additions,issues:[],warnings:[],alreadyImported:0,deferredRows:0,income:0,units:0,sourceRows:sources.reduce((n,s)=>n+s.rows.length,0),nextNumber:data.metadata.find(m=>m.key==='sale-number')?.value??0}
  const maps=new Map(data.importRecords.map(r=>[r.sourceKey,r])),seenKeys=new Set<string>()
  const sourceKey=(s:ImportSource,row:number,kind:string=s.kind)=>`${kind}:${s.hash}:${row}`
  function record(s:ImportSource,row:number,targetId:string,kind:ImportRecord['kind']=s.kind,original=s.rows[row-2]) {
    const source=sourceKey(s,row,kind)
    if(maps.has(source)||seenKeys.has(source))return
    const item:ImportRecord={id:uid(source),sourceKey:source,sourceHash:s.hash,sourceName:s.name,kind,row,targetId,batchId,createdAt:now,original}
    additions.importRecords.push(item);seenKeys.add(source);return item
  }
  function classification(kind:'categories'|'families'|'ips',raw:string):string|undefined {
    const name=raw.trim(),key=`${kind}:${normalizedName(raw)}`
    if(!name){plan.issues.push({key,message:`${kind}: nombre vacío.`});return}
    const matches=[...data[kind],...additions[kind]].filter(c=>normalizedName(c.name)===normalizedName(name))
    if(matches.length>1){const choice=matches.find(c=>c.id===choices[key]);if(choice)return choice.id;plan.issues.push({key,message:`${name}: varias clasificaciones locales equivalentes.`,options:matches.map(c=>({id:c.id,label:c.name}))});return}
    if(matches.length){if(matches[0].name!==raw)plan.warnings.push(`Clasificación «${raw}» → «${matches[0].name}» (mayúsculas/espacios).`);return matches[0].id}
    const id=uid(key)
    additions[kind].push({id,name,normalizedName:normalizedName(name),isActive:true,order:data[kind].length+additions[kind].length,createdAt:now,updatedAt:now,...(kind==='categories'?{activeName:normalizedName(name)}:{})})
    return id
  }
  for(const s of sources.filter(s=>s.kind==='families'||s.kind==='ips'))s.rows.forEach((row,index)=>{
    const rowNumber=index+2,key=sourceKey(s,rowNumber)
    if(maps.has(key)||seenKeys.has(key)){plan.alreadyImported++;return}
    const id=classification(s.kind as 'families'|'ips',row.Nombre);if(id)record(s,rowNumber,id)
  })
  for(const s of sources.filter(s=>s.kind==='catalog'))s.rows.forEach((row,index)=>{
    const n=index+2,key=sourceKey(s,n)
    if(maps.has(key)||seenKeys.has(key)){plan.alreadyImported++;return}
    try {
      const name=row.Nombres.trim();if(!name)throw new Error('Nombre vacío.')
      const price=amount(row.Precios,'Precio'),categoryName=choices[`category:${key}`]||categoryFor(name,price)
      if(!categoryName){plan.issues.push({key:`category:${key}`,message:`${name}: indica categoría principal.`,text:true});return}
      const categoryId=classification('categories',categoryName),familyId=classification('families',row.Familias),ipId=classification('ips',row.Ips)
      if(!categoryId||!familyId||!ipId)return
      const products=[...data.products,...additions.products]
      const candidates=products.filter(p=>normalizedName(p.name)===normalizedName(name))
      let product=products.find(p=>p.id===choices[key])
      const exact=candidates.filter(p=>p.categoryId===categoryId&&p.price===price&&(p.familyIds??[]).includes(familyId)&&(p.ipIds??[]).includes(ipId))
      if(!product && exact.length===1)product=exact[0]
      if(!product&&candidates.length){plan.issues.push({key,message:`${name}: revisar formato, asociaciones o precio (origen $${price}). Se conserva íntegro el producto local seleccionado.`,options:candidates.map(p=>({id:p.id,label:`${p.name} · $${p.price}${p.isArchived?' · Archivado':''}`}))});return}
      if(product){if(product.price!==price)plan.warnings.push(`${name}: origen $${price}, local $${product.price}; se conserva precio local.`);if(product.isArchived)plan.warnings.push(`${name}: se conserva archivado.`)}
      else {
        product={id:uid(key),name,categoryId,categoryIds:[categoryId],familyIds:[familyId],ipIds:[ipId],price,stock:0,stockCountPending:true,lowStockThreshold:0,averageCostIsProvisional:false,isFavorite:false,isArchived:false,createdAt:now,updatedAt:now,revision:1,activeName:normalizedName(name)}
        additions.products.push(product)
      }
      record(s,n,product.id)
    } catch(error){plan.issues.push({key,message:`${s.name}, fila ${n}: ${error instanceof Error?error.message:'Inválida'}`})}
  })
  const products=[...data.products,...additions.products],events=[...data.managedEvents],duplicateRows=new Map<string,number>()
  for(const s of sources.filter(s=>s.kind==='sales')) {
    const dates=new Map<string,string[]>()
    for(const row of s.rows){const key=normalizedName(row.Evento);dates.set(key,[...(dates.get(key)??[]),row.Fecha])}
    s.rows.forEach((row,index)=>{
      const n=index+2,key=sourceKey(s,n)
      if(maps.has(key)||seenKeys.has(key)){plan.alreadyImported++;return}
      try {
        if(Object.values(row).some(value=>!value.trim()))throw new Error('Campos vacíos.')
        const quantity=amount(row.Cantidad,'Cantidad',true),total=amount(row.Precio_Total,'Total'),soldAt=chileanInstant(row.Fecha,row.Hora)
        if(total%quantity)throw new Error('Total no divisible en CLP enteros por cantidad; revisar antes de importar.')
        const method=({efectivo:'cash',transferencia:'transfer','transferencia/mach':'transfer',debito:'debit','débito':'debit'} as const)[normalizedName(row.Metodo_Pago) as 'efectivo']
        if(!method)throw new Error(`Método de pago no reconocido: ${row.Metodo_Pago}.`)
        const productKey=`sale-product:${normalizedName(row.Categoria)}:${normalizedName(row.Producto)}`
        if(choices[productKey]==='pending'){plan.deferredRows++;plan.warnings.push(`Fila ${n}: ${row.Producto} queda pendiente; no se importa ni se marca como procesada.`);return}
        const categoryIds=[...data.categories,...additions.categories].filter(c=>normalizedName(c.name)===normalizedName(row.Categoria)).map(c=>c.id)
        let product:CatalogProduct|undefined=products.find(p=>p.id===choices[productKey])
        const exact=products.filter(p=>normalizedName(p.name)===normalizedName(row.Producto)&&categoryIds.includes(p.categoryId??''))
        if(!product&&exact.length===1)product=exact[0]
        if(!product){plan.issues.push({key:productKey,message:`${row.Producto} (${row.Categoria}): selecciona correspondencia verificada; no se creará producto desde la venta.`,options:[{id:'pending',label:'Dejar pendiente (no importar)'},...products.map(p=>({id:p.id,label:`${p.name} · ${[...data.categories,...additions.categories].find(c=>c.id===p.categoryId)?.name??'Sin categoría'}`}))]});return}
        const eventKey=`event:${normalizedName(row.Evento)}`,eventDates=dates.get(normalizedName(row.Evento))!.slice().sort()
        let event=[...events,...additions.managedEvents].find(e=>e.id===choices[eventKey])
        const sameName=[...events,...additions.managedEvents].filter(e=>normalizedName(e.name)===normalizedName(row.Evento))
        if(!event&&sameName.length===1&&sameName[0].startDate<=eventDates[0]&&sameName[0].endDate>=eventDates.at(-1)!)event=sameName[0]
        if(!event&&sameName.length&&choices[eventKey]!=='new'){plan.issues.push({key:eventKey,message:`${row.Evento}: verifica evento y fechas.`,options:[...sameName.map(e=>({id:e.id,label:`${e.name}: ${e.startDate} / ${e.endDate}`})),{id:'new',label:'Crear evento histórico independiente'}]});return}
        if(!event){event={id:uid(eventKey),name:row.Evento.trim(),startDate:eventDates[0],endDate:eventDates.at(-1)!,status:'finished',createdAt:now,updatedAt:now};additions.managedEvents.push(event)}
        record(s,n,event.id,'event')
        const identical=JSON.stringify(row),first=duplicateRows.get(identical);if(first)plan.warnings.push(`Filas ${first} y ${n} idénticas: se conservan ambas.`);else duplicateRows.set(identical,n)
        if(data.sales.some(sale=>!sale.historicalSource&&sale.soldAt===soldAt&&sale.total===total&&sale.items.some(i=>i.productId===product!.id&&i.quantity===quantity)) && choices[`manual:${key}`]!=='keep') {plan.issues.push({key:`manual:${key}`,message:`Fila ${n}: posible coincidencia con venta local. Confirmar que es otro registro.`,options:[{id:'keep',label:'Conservar como registro histórico independiente'}]});return}
        const id=uid(key),provenance=record(s,n,id)!
        const payments=total?[{id:uid(`payment:${key}`),saleId:id,method,amount:total,createdAt:soldAt}]:[]
        const sale:StoredSale={id,operationId:uid(`operation:${key}`),operationFingerprint:key,number:++plan.nextNumber,soldAt,createdAt:now,items:[{productId:product.id,name:row.Producto,categoryIds:categoryIds.length===1?categoryIds:[],quantity,unitPrice:total/quantity,lineTotal:total,cost:{source:'unknown',condition:'unknown',isProvisional:false},stock:{quantitySold:quantity,previousStock:0,quantityDeducted:0,resultingStock:0,uncoveredQuantity:0}}],subtotal:total,discount:0,total,payments,event:{id:event.id,name:row.Evento},status:'completed',stockDifferences:[],movementIds:[],historicalSource:{recordId:provenance.id,batchId,file:s.name,hash:s.hash,row:n,importedAt:now,original:row}}
        additions.sales.push(sale);additions.payments.push(...payments);plan.income+=total;plan.units+=quantity
      } catch(error){plan.issues.push({key,message:`${s.name}, fila ${n}: ${error instanceof Error?error.message:'Inválida'}`})}
    })
  }
  plan.issues=[...new Map(plan.issues.map(i=>[i.key,i])).values()];plan.warnings=[...new Set(plan.warnings)]
  return plan
}
