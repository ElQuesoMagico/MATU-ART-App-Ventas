import { z } from 'zod'
import type { DataSnapshot } from './snapshot.ts'
import { canonical, stores } from './snapshot.ts'
import { normalizedName } from '../catalogValidation.ts'
import { validatePromotion } from '../promotionConditions.ts'

const id = z.uuid(), text = z.string().max(100_000), name = text.min(1), integer = z.number().int().safe(), money = integer.nonnegative()
const timestamp = z.iso.datetime({ offset: true }), day = z.iso.date(), ids = z.array(id)
const base = { id, createdAt: timestamp }, named = { ...base, name, updatedAt: timestamp }, optionalCost = money.optional()
const cost = z.object({ unitCost: optionalCost, source: z.enum(['estimated','average','last-known','unknown']), isProvisional: z.boolean(), condition: z.enum(['known','estimated','provisional','unknown']).optional() }).passthrough()
const costState = z.object({ averageCost: optionalCost, lastKnownCost: optionalCost, averageCostIsProvisional: z.boolean() }).passthrough()
const discount = z.object({ type: z.enum(['percentage','fixed']), value: z.number().nonnegative(), amount: money, baseAmount: money, source: z.literal('manual') }).passthrough()
const payment = z.object({ ...base, saleId: id, method: z.enum(['cash','transfer','debit']), amount: money }).passthrough()
const classification = z.object({ ...named, description: text.optional(), order: integer, isActive: z.boolean(), normalizedName: text.optional(), activeName: text.optional() }).passthrough()
const promotion = z.object({ ...named, type: z.enum(['percentage','fixed','combo','quantity']), value: z.number().nonnegative().finite(), productIds: ids, categoryIds: ids, familyIds: ids, ipIds: ids, eventIds: ids.optional(), minimumQuantity: money, minimumAmount: money, isActive: z.boolean(), isArchived: z.boolean(), isStackable: z.boolean(), startDate: day.optional(), endDate: day.optional(), groupQuantity: integer.positive().optional(), components: z.array(z.object({ id, kind: z.enum(['product','category']), targetId: id, quantity: integer.positive() }).passthrough()).optional() }).passthrough()
const benefitProduct = z.object({ productId: id, quantity: integer.positive(), amount: money }).passthrough()
const appliedPromotion = z.object({ id, name, type: promotion.shape.type, value: z.number().nonnegative(), amount: money, products: z.array(benefitProduct), configuration: promotion }).passthrough()
const combo = z.object({ id, name, price: money, applications: integer.positive(), originalAmount: money, amount: money, configuration: promotion, products: z.array(benefitProduct.extend({originalAmount: money})), occurrences: z.array(z.object({ originalAmount: money, baseAmount: money, amount: money, products: z.array(benefitProduct.extend({ originalAmount: money })) }).passthrough()) }).passthrough()
const movement = z.object({ ...base, productId: id, type: z.enum(['initial','restock','adjustment','count','sale','sale_void','manual_reversal']), quantityChange: integer, previousStock: integer, resultingStock: integer, requestedQuantity: integer, unitCost: optionalCost, reason: text.optional(), saleId: id.optional(), uncoveredQuantity: money.optional(), costBefore: costState.optional(), costAfter: costState.optional(), productRevisionAfter: integer.optional(), reversedById: id.optional(), reversesMovementId: id.optional() }).passthrough()
const expense = z.object({ ...base, concept: name, amount: integer.positive(), categoryId: id, date: day, eventId: id.optional(), notes: text.optional(), updatedAt: timestamp, revision: integer.positive(), status: z.enum(['active','voided']) }).passthrough()
export const dataSchema = z.object({
  importRecords:z.array(z.object({id,sourceKey:name,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),sourceName:name,kind:z.enum(['catalog','families','ips','sales','event']),row:integer.min(2),targetId:id,batchId:id,createdAt:timestamp,original:z.record(z.string(),z.string())}).strict()),
  products: z.array(z.object({ ...named, description: text.optional(), categoryIds: ids, categoryId: id.optional(), familyIds: ids.optional(), ipIds: ids.optional(), classificationPending: z.boolean().optional(), price: money, stock: integer, stockCountPending:z.boolean().optional(), lowStockThreshold: money, averageCost: optionalCost, estimatedUnitCost: optionalCost, lastKnownCost: optionalCost, averageCostIsProvisional: z.boolean(), revision: integer.positive(), isFavorite: z.boolean(), isArchived: z.boolean(), activeName: text.optional(), kind: z.enum(['product','pack']).optional(), packContents: z.array(z.object({productId: id, quantity: integer.positive()}).passthrough()).optional(), eventPrices: z.array(z.object({eventId:id,price:money}).passthrough()).optional(), image: z.instanceof(Blob).optional() }).passthrough()),
  categories: z.array(classification), families: z.array(classification), ips: z.array(classification),
  movements: z.array(movement),
  costChanges: z.array(z.object({...base,productId:id,previousValue:optionalCost,newValue:optionalCost,reason:text.optional()}).passthrough()),
  sales: z.array(z.object({ ...base, operationId:id, operationFingerprint:text, historicalSource:z.object({recordId:id,batchId:id,file:name,hash:z.string().regex(/^[a-f0-9]{64}$/),row:integer.min(2),importedAt:timestamp,original:z.record(z.string(),z.string())}).strict().optional(), number:integer.positive(), soldAt:timestamp, subtotal:money, discount:money, total:money, status:z.enum(['completed','voided']), event:z.object({id,name}).passthrough().optional(), generalDiscount:discount.optional(), appliedPromotions:z.array(appliedPromotion).optional(), appliedCombos:z.array(combo).optional(), items:z.array(z.object({productId:id,name,description:text.optional(),productKind:z.enum(['product','pack']).optional(),packContents:z.array(z.object({productId:id,name,quantity:integer.positive()}).passthrough()).optional(),priceSnapshot:z.object({unitPrice:money,generalPrice:money,source:z.enum(['general','event']),eventId:id.optional()}).passthrough().optional(),quantity:integer.positive(),unitPrice:money,lineTotal:money,netLineTotal:money.optional(),promotionDiscount:money.optional(),categoryIds:ids,cost,stock:z.object({quantitySold:integer.positive(),previousStock:integer,quantityDeducted:money,resultingStock:integer,uncoveredQuantity:money}).passthrough(),appliedDiscount:discount.optional()}).passthrough()).min(1), payments:z.array(payment), movementIds:ids, stockDifferences:z.array(z.object({productId:id,quantity:money}).passthrough()), voidAudit:z.object({operationId:id,reason:name,returnStock:z.boolean(),voidedAt:timestamp,movementIds:ids}).passthrough().optional() }).passthrough()),
  payments:z.array(payment), metadata:z.array(z.object({key:name,value:money}).strict()),
  events:z.array(z.object({...base,name,isActive:z.boolean()}).passthrough()),
  managedEvents:z.array(z.object({...named,description:text.optional(),location:text.optional(),activatedAt:timestamp.optional(),finishedAt:timestamp.optional(),startDate:day,endDate:day,status:z.enum(['upcoming','active','finished']),activeKey:z.literal('active').optional()}).passthrough()),
  promotions:z.array(promotion), expenses:z.array(expense),
  expenseCategories:z.array(z.object({...base,name,normalizedName:name}).passthrough()),
  expenseChanges:z.array(z.object({...base,expenseId:id,type:z.enum(['create','edit','void']),before:expense.optional(),after:expense,reason:text.optional(),fingerprint:text}).passthrough()),
}).strict()

function fail(message: string): never { throw new Error(`Respaldo inválido: ${message}`) }
/** Validate structure and all live references; historical event/promotional copies remain self-contained. */
export function validateData(value: unknown): asserts value is DataSnapshot {
  const result = dataSchema.safeParse(value)
  if (!result.success) { const issue = result.error.issues[0]; fail(`${issue.path.join('.')}: ${issue.message}`) }
  const data = value as DataSnapshot
  const sets = Object.fromEntries(stores.map(store => [store, new Set(data[store].map(row => 'id' in row ? row.id : row.key))])) as Record<typeof stores[number], Set<string>>
  for (const store of stores) if (sets[store].size !== data[store].length) fail(`UUID o clave repetida en ${store}.`)
  const ref = (store: typeof stores[number], key?: string) => { if (key !== undefined && !sets[store].has(key)) fail(`Falta referencia ${store}/${key}.`) }
  const unique = (values: (string | number | undefined)[], label: string) => { const present = values.filter(v=>v!==undefined); if(new Set(present).size!==present.length) fail(`Valor duplicado: ${label}.`) }
  unique(data.products.map(p=>p.activeName),'nombre activo'); unique(data.sales.map(s=>s.number),'número de venta'); unique(data.sales.map(s=>s.operationId),'operación de venta'); unique(data.expenseCategories.map(c=>c.normalizedName),'categoría de gasto')
  unique(data.categories.map(c=>c.activeName),'categoría activa')
  unique(data.managedEvents.map(e=>e.activeKey),'evento activo')
  for(const event of data.managedEvents) if(event.endDate<event.startDate || (event.status==='active')!==(event.activeKey==='active')) fail('Estado o fechas de evento inconsistentes.')
  unique(data.importRecords.map(r=>r.sourceKey),'procedencia de importación')
  for(const r of data.importRecords) ref(r.kind==='catalog'?'products':r.kind==='event'?'managedEvents':r.kind,r.targetId)
  for(const product of data.products) {
    if(product.stockCountPending && product.stock!==0)fail('Stock pendiente no puede contener existencias confirmadas.');
    ref('categories',product.categoryId); product.categoryIds.forEach(key=>ref('categories',key)); product.familyIds?.forEach(key=>ref('families',key)); product.ipIds?.forEach(key=>ref('ips',key)); product.packContents?.forEach(p=>ref('products',p.productId)); product.eventPrices?.forEach(p=>ref('managedEvents',p.eventId)); unique(product.eventPrices?.map(p=>p.eventId)??[],'precio por evento')
    if(product.isArchived ? product.activeName!==undefined : product.activeName!==normalizedName(product.name)) fail('Índice de producto activo inconsistente.')
    if(product.image && (!['image/png','image/jpeg','image/webp','image/gif'].includes(product.image.type) || product.image.size>10*1024*1024)) fail('Imagen no compatible o mayor de 10 MB.')
  }
  for(const p of data.promotions) { validatePromotion(p); p.productIds.forEach(key=>ref('products',key)); p.categoryIds.forEach(key=>ref('categories',key)); p.familyIds.forEach(key=>ref('families',key)); p.ipIds.forEach(key=>ref('ips',key)); p.eventIds?.forEach(key=>ref('managedEvents',key)); p.components?.forEach(c=>ref(c.kind==='product'?'products':'categories',c.targetId)); }
  const movementMap = new Map(data.movements.map(m=>[m.id,m])), saleMap = new Map(data.sales.map(s=>[s.id,s])), paymentMap = new Map(data.payments.map(p=>[p.id,p]))
  for(const m of data.movements) { ref('products',m.productId); ref('sales',m.saleId); ref('movements',m.reversedById); ref('movements',m.reversesMovementId); if(m.previousStock+m.quantityChange!==m.resultingStock) fail('Movimiento con stock inconsistente.'); if(m.reversesMovementId&&movementMap.get(m.reversesMovementId)?.reversedById!==m.id) fail('Reversión sin vínculo recíproco.') }
  for(const c of data.costChanges) ref('products',c.productId)
  for(const sale of data.sales) {
    if(sale.historicalSource) {
      const source=sale.historicalSource; const record=data.importRecords.find(r=>r.id===source.recordId);
      if(!record||record.kind!=='sales'||record.targetId!==sale.id||record.sourceHash!==source.hash||record.row!==source.row||record.batchId!==source.batchId||record.sourceName!==source.file||record.createdAt!==source.importedAt||canonical(record.original)!==canonical(source.original)||sale.movementIds.length||sale.stockDifferences.length||sale.voidAudit?.returnStock||sale.items.some(i=>i.cost.source!=='unknown'||i.cost.unitCost!==undefined||i.stock.quantityDeducted!==0||i.stock.previousStock!==0||i.stock.resultingStock!==0||i.stock.uncoveredQuantity!==0))fail('Procedencia histórica o inventario de importación inconsistente.');
    }
    if(sale.subtotal-sale.discount!==sale.total || sale.items.reduce((n,i)=>n+BigInt(i.lineTotal),0n)!==BigInt(sale.subtotal)) fail('Totales históricos inconsistentes.')
    if(sale.payments.reduce((n,p)=>n+BigInt(p.amount),0n)!==BigInt(sale.total)) fail('Los pagos no coinciden con la venta.')
    unique(sale.payments.map(p=>p.id),'pago de venta')
    for(const p of sale.payments) if(p.saleId!==sale.id || canonical(paymentMap.get(p.id))!==canonical(p)) fail('Copia de pago inconsistente.')
    for(const i of sale.items) { ref('products',i.productId); i.categoryIds.forEach(key=>ref('categories',key)); i.packContents?.forEach(c=>ref('products',c.productId)); if(i.quantity*i.unitPrice!==i.lineTotal || i.stock.quantitySold!==i.quantity || (!sale.historicalSource && i.stock.quantityDeducted+i.stock.uncoveredQuantity!==i.quantity) || i.stock.previousStock-i.stock.quantityDeducted!==i.stock.resultingStock) fail('Línea de venta inconsistente.') }
    for(const benefit of [...(sale.appliedPromotions??[]),...(sale.appliedCombos??[])]) benefit.products.forEach(p=>ref('products',p.productId))
    for(const key of [...sale.movementIds,...(sale.voidAudit?.movementIds??[])]) { ref('movements',key); if(movementMap.get(key)?.saleId!==sale.id) fail('Movimiento de otra venta.') }
    if((sale.status==='voided')!==!!sale.voidAudit) fail('Estado de anulación inconsistente.')
  }
  for(const payment of data.payments) { ref('sales',payment.saleId); if(!saleMap.get(payment.saleId)?.payments.some(p=>p.id===payment.id)) fail('Pago huérfano.') }
  const counter=data.metadata.find(m=>m.key==='sale-number')?.value??0
  if(data.sales.some(s=>s.number>counter)) fail('Contador de ventas incompleto.')
  const checkExpense = (e: DataSnapshot['expenses'][number]) => { ref('expenseCategories',e.categoryId); ref('managedEvents',e.eventId) }
  data.expenses.forEach(checkExpense)
  for(const change of data.expenseChanges) { ref('expenses',change.expenseId); checkExpense(change.after); if(change.before) checkExpense(change.before); if(change.after.id!==change.expenseId || (change.before&&change.before.id!==change.expenseId)) fail('Auditoría de gasto inconsistente.') }
  const histories=new Map<string,DataSnapshot['expenseChanges']>()
  for(const change of data.expenseChanges) {const history=histories.get(change.expenseId)??[];history.push(change);histories.set(change.expenseId,history)}
  for(const expense of data.expenses) {
    const history=(histories.get(expense.id)??[]).sort((a,b)=>a.after.revision-b.after.revision)
    if(!history.length||canonical(history.at(-1)!.after)!==canonical(expense)) fail('Falta auditoría vigente de gasto.')
    for(let i=0;i<history.length;i++) if(history[i].after.revision!==i+1 || (i===0 ? history[i].type!=='create'||history[i].before!==undefined : canonical(history[i].before)!==canonical(history[i-1].after))) fail('Cadena de auditoría de gasto incompleta.')
  }
}
