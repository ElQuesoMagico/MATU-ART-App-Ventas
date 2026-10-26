import type { DataSnapshot } from './snapshot.ts'
import { buildAnalytics, historicalLineRevenues, rankProducts } from '../analytics.ts'
import { santiagoDay } from '../../utils/format.ts'

export interface ExportFilters { eventId?: string; saleStart?: string; saleEnd?: string; productState?: 'all'|'active'|'archived'; movementProductId?: string; movementStart?: string; movementEnd?: string }
export type Cell = string | number | boolean | undefined | null
export interface DataTable { name:string; columns:string[]; rows:Cell[][] }
const value = (v:unknown):Cell => v===undefined||v===null ? '' : typeof v==='bigint' ? v<=BigInt(Number.MAX_SAFE_INTEGER)&&v>=BigInt(Number.MIN_SAFE_INTEGER)?Number(v):v.toString() : typeof v==='string'||typeof v==='number'||typeof v==='boolean' ? v : JSON.stringify(v)
export const table = (name:string, columns:string[], rows:unknown[][]):DataTable => ({name,columns,rows:rows.map(row=>row.map(value))})
const inPeriod=(date:string,start?:string,end?:string)=>(!start||date>=start)&&(!end||date<=end)
const matchesEvent=(id:string|undefined,filter?:string)=>!filter||filter==='all'||(filter==='none'?!id:id===filter)
export function exportTables(data:DataSnapshot, filters:ExportFilters={}):DataTable[] {
  for(const [start,end] of [[filters.saleStart,filters.saleEnd],[filters.movementStart,filters.movementEnd]]) if(start&&end&&start>end) throw new Error('La fecha inicial debe ser anterior o igual a la final.')
  const sales=data.sales.filter(s=>matchesEvent(s.event?.id,filters.eventId)&&inPeriod(santiagoDay(s.soldAt),filters.saleStart,filters.saleEnd))
  const movements=data.movements.filter(m=>(!filters.movementProductId||m.productId===filters.movementProductId)&&inPeriod(santiagoDay(m.createdAt),filters.movementStart,filters.movementEnd))
  const selectedProducts=new Set(data.products.filter(p=>!filters.productState||filters.productState==='all'||(filters.productState==='archived'?p.isArchived:!p.isArchived)).map(p=>p.id))
  // Include referenced products without applying current catalog filters to historical sales.
  const referenced=new Set([...sales.flatMap(s=>s.items.map(i=>i.productId)),...movements.map(m=>m.productId),...data.costChanges.map(c=>c.productId),...data.promotions.flatMap(p=>[...p.productIds,...(p.components??[]).filter(c=>c.kind==='product').map(c=>c.targetId)])])
  const selectedSaleIds=new Set(sales.map(s=>s.id))
  const referenceSaleIds=new Set(movements.flatMap(m=>m.saleId&&!selectedSaleIds.has(m.saleId)?[m.saleId]:[]))
  const referenceSales=data.sales.filter(s=>referenceSaleIds.has(s.id))
  referenceSales.forEach(s=>s.items.forEach(i=>referenced.add(i.productId)))
  const selectedMovementIds=new Set(movements.map(m=>m.id))
  const referenceMovementIds=new Set([...sales.flatMap(s=>[...s.movementIds,...(s.voidAudit?.movementIds??[])]),...movements.flatMap(m=>[m.reversesMovementId,m.reversedById].filter((id):id is string=>!!id))].filter(id=>!selectedMovementIds.has(id)))
  const productIds=new Set([...selectedProducts,...referenced]); let added=true
  while(added) { added=false; for(const p of data.products) if(productIds.has(p.id)) for(const content of p.packContents??[]) if(!productIds.has(content.productId)) {productIds.add(content.productId);added=true} }
  const products=data.products.filter(p=>productIds.has(p.id)), expenses=data.expenses.filter(e=>matchesEvent(e.eventId,filters.eventId))
  const expenseIds=new Set(expenses.map(e=>e.id))
  const analytics=buildAnalytics(sales,data.managedEvents,expenses)
  const events=analytics.events.filter(e=>matchesEvent(e.id,filters.eventId))
  const tables:DataTable[]=[
    table('Procedencia importación',['UUID','Fuente','Hash','Tipo','Fila','Entidad UUID','Lote','Original'],data.importRecords.map(r=>[r.id,r.sourceName,r.sourceHash,r.kind,r.row,r.targetId,r.batchId,r.original])),
    table('Criterios',['Criterio','Valor'],[['Moneda','CLP'],['Fechas','Instantes ISO 8601 UTC; filtros y días America/Santiago; fechas de evento/gasto YYYY-MM-DD'],['Filtros',filters],['Ventas','Cada fila histórica importada es un registro independiente; transacciones originales desconocidas. Total por venta. No sumar pagos al total. Anuladas conservadas; excluidas de estadísticas.'],['Productos','Seleccionados + dependencias históricas identificadas. Catálogo actual separado del precio/costo de venta.'],['Ámbito','Evento: ventas, gastos y estadísticas. Período de ventas: solo ventas y estadísticas. Período/producto de movimientos: solo movimientos. Gastos del evento completos, sin prorrateo.'],['Respaldo','CSV y Excel no son respaldos restaurables; usa el JSON completo.']]),
    table('Productos',['UUID producto','Nombre','Descripción','Tipo','Archivado','Solo referencia','Categoría UUID','Familias UUID','IPs UUID','Precio general CLP','Precios evento','Destacado','Creado UTC','Modificado UTC','Imagen MIME','Imagen bytes','Contenido pack'],products.map(p=>[p.id,p.name,p.description,p.kind??'product',p.isArchived,!selectedProducts.has(p.id),p.categoryId,p.familyIds,p.ipIds,p.price,p.eventPrices,p.isFavorite,p.createdAt,p.updatedAt,p.image?.type,p.image?.size,p.packContents])),
    table('Inventario y costos',['UUID producto','Nombre','Stock','Umbral bajo','Costo promedio CLP','Promedio provisional','Último costo CLP','Costo estimado CLP','Revisión'],products.map(p=>[p.id,p.name,p.stockCountPending?'Pendiente de conteo':p.stock,p.lowStockThreshold,p.averageCost,p.averageCostIsProvisional,p.lastKnownCost,p.estimatedUnitCost,p.revision])),
    ...(['categories','families','ips'] as const).map((store,index)=>table(['Categorías','Familias','IPs'][index],['UUID','Nombre','Descripción','Orden','Activa','Creado UTC','Modificado UTC'],data[store].map(c=>[c.id,c.name,c.description,c.order,c.isActive,c.createdAt,c.updatedAt]))),
    table('Movimientos',['UUID movimiento','Producto UUID','Tipo','Cantidad','Stock anterior','Stock posterior','Fecha UTC','Motivo','Costo unitario CLP','Venta UUID','Revierte UUID','Revertido por UUID','Costos anteriores','Costos posteriores'],movements.map(m=>[m.id,m.productId,m.type,m.quantityChange,m.previousStockUnknown?'Desconocido':m.previousStock,m.resultingStock,m.createdAt,m.reason,m.unitCost,m.saleId,m.reversesMovementId,m.reversedById,m.costBefore,m.costAfter])),
    table('Cambios costo',['UUID','Producto UUID','Valor anterior CLP','Valor nuevo CLP','Fecha UTC','Motivo'],data.costChanges.map(c=>[c.id,c.productId,c.previousValue,c.newValue,c.createdAt,c.reason])),
    table('Ventas',['UUID venta','Número','Procedencia','Estado','Fecha UTC','Día Chile','Evento UUID','Evento histórico','Subtotal original CLP','Descuentos CLP','Total cobrado CLP','Operación UUID','Anulación'],sales.map(s=>[s.id,s.number,s.historicalSource,s.status,s.soldAt,santiagoDay(s.soldAt),s.event?.id,s.event?.name,s.subtotal,s.discount,s.total,s.operationId,s.voidAudit])),
    table('Detalle ventas',['Venta UUID','Línea','Producto UUID','Nombre histórico','Cantidad','Precio unitario CLP','Subtotal original CLP','Ingreso asignado CLP','Costo histórico CLP','Origen costo','Condición costo','Provisional','Precio origen','Descuento manual','Descuento automático CLP','Stock descontado','Diferencia no cubierta','Contenido pack histórico'],sales.flatMap(s=>{const allocated=historicalLineRevenues(s);return s.items.map((i,n)=>[s.id,n+1,i.productId,i.name,i.quantity,i.unitPrice,i.lineTotal,allocated[n],i.cost.unitCost,i.cost.source,i.cost.condition,i.cost.isProvisional,i.priceSnapshot,i.appliedDiscount,i.promotionDiscount,i.stock.quantityDeducted,i.stock.uncoveredQuantity,i.packContents])})),
    table('Pagos',['UUID pago','Venta UUID','Estado venta','Método','Importe CLP','Fecha UTC'],sales.flatMap(s=>s.payments.map(p=>[p.id,p.saleId,s.status,p.method,p.amount,p.createdAt]))),
    table('Descuentos aplicados',['Venta UUID','Origen','Producto UUID','Beneficio UUID','Nombre histórico','Tipo','Valor configurado','Descuento efectivo CLP','Copia histórica'],sales.flatMap(s=>[...s.items.filter(i=>i.appliedDiscount).map(i=>[s.id,'manual línea',i.productId,'','',i.appliedDiscount!.type,i.appliedDiscount!.value,i.appliedDiscount!.amount,i.appliedDiscount]),...(s.generalDiscount?[[s.id,'manual general','','','',s.generalDiscount.type,s.generalDiscount.value,s.generalDiscount.amount,s.generalDiscount]]:[]),...(s.appliedPromotions??[]).map(p=>[s.id,'promoción','',p.id,p.name,p.type,p.value,p.amount,p]),...(s.appliedCombos??[]).map(p=>[s.id,'combo','',p.id,p.name,'combo',p.price,p.amount,p])])),
    table('Promociones y combos',['UUID','Nombre','Tipo','Activa','Archivada','Configuración completa'],data.promotions.map(p=>[p.id,p.name,p.type,p.isActive,p.isArchived,p])),
    table('Eventos',['UUID','Nombre','Inicio','Fin','Estado','Ubicación','Descripción','Creado UTC','Modificado UTC'],data.managedEvents.map(e=>[e.id,e.name,e.startDate,e.endDate,e.status,e.location,e.description,e.createdAt,e.updatedAt])),
    table('Referencias históricas',['Entidad','UUID','Copia histórica fuera del filtro'],[...referenceSales.map(s=>['Venta',s.id,s]),...data.movements.filter(m=>referenceMovementIds.has(m.id)).map(m=>['Movimiento',m.id,m])]),
    table('Eventos históricos',['UUID','Nombre','Activo','Creado UTC'],data.events.map(e=>[e.id,e.name,e.isActive,e.createdAt])),
    table('Gastos',['UUID','Concepto','Importe CLP','Categoría UUID','Fecha','Evento UUID','Notas','Estado','Creado UTC','Modificado UTC'],expenses.map(e=>[e.id,e.concept,e.amount,e.categoryId,e.date,e.eventId,e.notes,e.status,e.createdAt,e.updatedAt])),
    table('Categorías gasto',['UUID','Nombre','Creado UTC'],data.expenseCategories.map(c=>[c.id,c.name,c.createdAt])),
    table('Auditoría gastos',['Operación UUID','Gasto UUID','Tipo','Fecha UTC','Motivo','Antes','Después'],data.expenseChanges.filter(c=>expenseIds.has(c.expenseId)).map(c=>[c.id,c.expenseId,c.type,c.createdAt,c.reason,c.before,c.after])),
    table('Estadísticas evento',['Evento UUID','Nombre','Ingresos CLP','Transacciones','Unidades','Ticket promedio CLP','Costos registrados CLP','Unidades sin costo','Unidades provisionales','Unidades estimadas','Utilidad bruta CLP','Gastos CLP','Utilidad neta CLP','Margen neto %'],events.map(e=>[e.id,e.name,e.metrics.revenue,e.metrics.transactions,e.metrics.units,e.metrics.averageTicket,e.metrics.recordedCost,e.metrics.unknownUnits,e.metrics.provisionalUnits,e.metrics.estimatedUnits,e.metrics.grossProfit??'No disponible',e.financial.expenses,e.financial.netProfit??'No disponible',e.financial.netMargin??'No disponible'])),
  ]
  return tables
}
export function eventReport(data:DataSnapshot,eventId:string) {
  const stats=buildAnalytics(data.sales,data.managedEvents,data.expenses).events.find(e=>e.id===eventId)
  if(!stats) throw new Error('El evento no existe.')
  const payments={cash:0n,transfer:0n,debit:0n}
  let discounts=0n,manual=0n,automatic=0n,combos=0n
  for(const {sale} of stats.records) { for(const p of sale.payments) payments[p.method]+=BigInt(p.amount); discounts+=BigInt(sale.discount); manual+=BigInt((sale.generalDiscount?.amount??0)+sale.items.reduce((n,i)=>n+(i.appliedDiscount?.amount??0),0)); automatic+=(sale.appliedPromotions??[]).reduce((n,p)=>n+BigInt(p.amount),0n); combos+=(sale.appliedCombos??[]).reduce((n,p)=>n+BigInt(p.amount),0n) }
  return {stats,ranking:rankProducts(stats.records),payments,discounts,manual,automatic,combos,expenses:data.expenses.filter(e=>e.eventId===eventId&&e.status==='active')}
}
/** Strings are never formulas. Prefix dangerous values before RFC4180 escaping. */
// eslint-disable-next-line no-control-regex -- Spreadsheet formula injection includes leading control characters.
export function csvCell(value:Cell):string { let s=String(value??''); if(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@\-\t\r\n]/u.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"' }
export function toCSV(data:DataTable) { return '\uFEFF'+[data.columns,...data.rows].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n' }
