import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBObjectStore } from 'fake-indexeddb'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import { ExpenseRepository } from '../src/services/expenseRepository.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import { readData, snapshotToken, canonical, stores } from '../src/services/data/snapshot.ts'
import { createBackup, parseBackup, prepareRestore, restoreBackup, digest } from '../src/services/data/backup.ts'
import { validateData } from '../src/services/data/backupValidation.ts'
import { csvCell, eventReport, exportTables, toCSV } from '../src/services/data/exportTables.ts'
import { csvArchive, excelFile } from '../src/services/data/fileFormats.ts'
import { eventPDF } from '../src/services/data/eventPDF.ts'
import { buildAnalytics } from '../src/services/analytics.ts'
import { ticketPath } from '../src/services/ticketGeometry.ts'
import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'

const id=()=>crypto.randomUUID()
async function fixture() {
 const name='data-'+id(), catalog=new CatalogRepository(name), sales=new SalesRepository(name), events=new EventRepository(name), expenses=new ExpenseRepository(name)
 const event=await events.save(id(),{name:'Feria = Arte',startDate:'2026-10-15',endDate:'2026-10-17'});await events.activate(event.id,event.updatedAt)
 const other=await events.save(id(),{name:'Otra feria',startDate:'2026-11-01',endDate:'2026-11-02'})
 const bytes=await readFile('src/assets/branding/clown-icon.png')
 const product=await catalog.createProduct({id:id(),name:'=Sticker "Cereza";\nEdición',categoryIds:[],price:1000,lowStockThreshold:2,isFavorite:false,initialStock:20,initialCost:200,image:new Blob([bytes],{type:'image/png'})})
 const sale=await sales.confirm({operationId:id(),items:[{productId:product.id,quantity:2,unitPrice:1000,expectedRevision:1,discount:{type:'percentage',value:10}}],generalDiscount:{type:'fixed',value:100},payments:[{method:'cash',amount:700},{method:'debit',amount:1000}]})
 const second=await sales.confirm({operationId:id(),items:[{productId:product.id,quantity:1,unitPrice:1000,expectedRevision:2}],payments:[{method:'transfer',amount:1000}]})
 await sales.voidSale({saleId:second.id,operationId:id(),reason:'Prueba anulación',returnStock:true})
 await catalog.setArchived(product.id,true,4)
 const category=(await expenses.snapshot()).expenseCategories[0]
 await expenses.save({id:id(),operationId:id(),fields:{concept:'Mesa',amount:100,date:'2026-10-15',categoryId:category.id,eventId:event.id}})
 await expenses.save({id:id(),operationId:id(),fields:{concept:'Global',amount:50,date:'2026-10-15',categoryId:category.id}})
 await catalog.close();await sales.close()
 return {name,product,event,other,sale,data:await readData(name)}
}
test('base vacía: todas las hojas y respaldo completo interpretable sin datos ficticios',async()=>{
 const data=await readData('empty-'+id()),text=await createBackup(data),parsed=await parseBackup(text)
 assert.equal(parsed.data.products.length,0);assert.equal(parsed.data.expenseCategories.length,7);assert.equal(parsed.data.sales.length,0)
 assert.equal(exportTables(data).find(t=>t.name==='Ventas')!.rows.length,0);assert.deepEqual(snapshotToken(parsed.data),snapshotToken(data))
})
test('respaldo y restauración completos conservan UUID, imágenes, referencias, pagos, costos y resultados tras reapertura',async()=>{
 const f=await fixture(),text=await createBackup(f.data),target='restore-'+id(),prepared=await prepareRestore(text,target)
 await restoreBackup(prepared.data,prepared.localToken,target)
 const reopened=await readData(target);validateData(reopened)
 assert.equal(snapshotToken(reopened),snapshotToken(f.data));assert.deepEqual(new Uint8Array(await reopened.products[0].image!.arrayBuffer()),new Uint8Array(await f.data.products[0].image!.arrayBuffer()))
 const restoredStats=buildAnalytics(reopened.sales,reopened.managedEvents,reopened.expenses),beforeStats=buildAnalytics(f.data.sales,f.data.managedEvents,f.data.expenses)
 assert.deepEqual(restoredStats.metrics,beforeStats.metrics)
 assert.deepEqual(restoredStats.events.map(e=>({id:e.id,metrics:e.metrics,financial:e.financial})),beforeStats.events.map(e=>({id:e.id,metrics:e.metrics,financial:e.financial})))
 assert.deepEqual(stores.map(s=>reopened[s].length),stores.map(s=>f.data[s].length))
})
test('restauración reemplaza, no mezcla, y una segunda restauración no duplica',async()=>{
 const f=await fixture(),empty=await readData('empty-'+id()),token=snapshotToken(f.data)
 await restoreBackup(empty,token,f.name);assert.equal((await readData(f.name)).products.length,0)
 const current=await readData(f.name);await restoreBackup(empty,snapshotToken(current),f.name);assert.equal((await readData(f.name)).expenseCategories.length,7)
})
test('archivo corrupto, checksum alterado, versiones y referencias inválidas se rechazan sin cambios',async()=>{
 const f=await fixture(),text=await createBackup(f.data)
 await assert.rejects(parseBackup('{mal'));await assert.rejects(parseBackup(text.replace('MATU ART','Otra aplicación')),/incompatible/)
 await assert.rejects(parseBackup(text.replace('"formatVersion":1','"formatVersion":99')),/incompatible/)
 await assert.rejects(parseBackup(text.replace('"databaseVersion":10','"databaseVersion":99')),/incompatible/)
 await assert.rejects(parseBackup(text.replace('Mesa','Otra')),/SHA-256/)
 const bad=structuredClone(f.data);bad.movements[0].productId=id();assert.throws(()=>validateData(bad),/referencia/)
 const envelope=JSON.parse(text);envelope.data.movements[0].productId=id();const {sha256:_hash,...body}=envelope;envelope.sha256=await digest(canonical(body));await assert.rejects(parseBackup(JSON.stringify(envelope)),/referencia/)
 assert.equal(snapshotToken(await readData(f.name)),snapshotToken(f.data))
})
test('pagos incompletos, auditoría ausente, imágenes temporales y UUID repetidos se rechazan',async()=>{
 const f=await fixture()
 for(const mutate of [(d:typeof f.data)=>{d.payments.pop()},(d:typeof f.data)=>{d.expenseChanges=[]},(d:typeof f.data)=>{d.products.push(d.products[0])},(d:typeof f.data)=>{d.sales[0].total++}]) {const bad=structuredClone(f.data);mutate(bad);assert.throws(()=>validateData(bad))}
 const raw=JSON.parse(await createBackup(f.data));raw.data.products[0].image='blob:temporal';const {sha256:_hash,...body}=raw;raw.sha256=await digest(canonical(body));await assert.rejects(parseBackup(JSON.stringify(raw)),/Imagen/)
})
test('fallo a mitad de restauración revierte incluso los clear previos',async()=>{
 const f=await fixture(),source=await readData('empty-'+id()),before=snapshotToken(f.data)
 const original=IDBObjectStore.prototype.add
 IDBObjectStore.prototype.add=function(...args:Parameters<typeof original>){if(this.name==='expenseCategories')throw new DOMException('Cuota agotada','QuotaExceededError');return original.apply(this,args)}
 try{await assert.rejects(restoreBackup(source,before,f.name),/Cuota/)}finally{IDBObjectStore.prototype.add=original}
 assert.equal(snapshotToken(await readData(f.name)),before)
})
test('cambios posteriores a vista previa y metadatos pendientes bloquean el reemplazo',async()=>{
 const f=await fixture(),prepared=await prepareRestore(await createBackup(f.data),f.name),db=await openCatalogDatabase(f.name)
 await db.put('metadata',{key:'event-price-revision',value:99});db.close()
 await assert.rejects(restoreBackup(prepared.data,prepared.localToken,f.name),/cambiaron/)
 const next=await openCatalogDatabase(f.name);await next.put('metadata',{key:'pending-sync-count',value:1});next.close()
 const data=await readData(f.name);await assert.rejects(restoreBackup(f.data,snapshotToken(data),f.name),/pendientes/);assert.equal(snapshotToken(await readData(f.name)),snapshotToken(data))
})
test('CSV: UTF8 BOM, comillas, saltos y prevención de fórmulas',()=>{
 for(const text of ['=1+1','+cmd','-2+3','@SUM(A1)',' \t=cmd','\r=cmd']) assert.match(csvCell(text),/^"'/)
 assert.equal(csvCell(-3),'"-3"');assert.equal(csvCell('a"b;c\nd'),'"a""b;c\nd"')
 assert(toCSV({name:'x',columns:['Nombre'],rows:[['Ñandú']]}).startsWith('\uFEFF'));assert.match(toCSV({name:'x',columns:['Nombre'],rows:[['Ñandú']]}),/Ñandú/)
})
test('filtros por evento, período, estado y movimiento no alteran copias históricas',async()=>{
 const f=await fixture(),tables=exportTables(f.data,{eventId:f.event.id,productState:'active',movementProductId:f.product.id})
 assert.equal(tables.find(t=>t.name==='Ventas')!.rows.length,2);assert.equal(tables.find(t=>t.name==='Pagos')!.rows.length,3)
 const product=tables.find(t=>t.name==='Productos')!.rows[0];assert.equal(product[4],true);assert.equal(product[5],true)
 assert.equal(tables.find(t=>t.name==='Gastos')!.rows.length,1)
 assert.equal(exportTables(f.data,{eventId:f.other.id}).find(t=>t.name==='Ventas')!.rows.length,0)
 assert.equal(exportTables(f.data,{saleEnd:'2000-01-01'}).find(t=>t.name==='Ventas')!.rows.length,0)
 assert.equal(exportTables(f.data,{movementStart:'2099-01-01'}).find(t=>t.name==='Movimientos')!.rows.length,0)
 assert.equal(exportTables(f.data,{eventId:'none'}).find(t=>t.name==='Gastos')!.rows.length,1)
})
test('informe usa Estadísticas: anuladas excluidas, pagos divididos y descuentos sin duplicar; global no asignado',async()=>{
 const f=await fixture(),report=eventReport(f.data,f.event.id)
 assert.equal(report.stats.metrics.revenue,1700n);assert.equal(report.stats.metrics.transactions,1);assert.equal(report.stats.metrics.units,2);assert.equal(report.stats.metrics.recordedCost,400n);assert.equal(report.stats.financial.expenses,100n);assert.equal(report.stats.financial.netProfit,1200n);assert.equal(report.discounts,300n);assert.equal(report.payments.cash+report.payments.debit+report.payments.transfer,1700n)
 const noCost=structuredClone(f.data);noCost.sales.find(s=>s.status==='completed')!.items[0].cost={source:'unknown',isProvisional:true};assert.equal(eventReport(noCost,f.event.id).stats.financial.netProfit,undefined)
 noCost.sales.find(s=>s.status==='completed')!.items[0].cost={source:'estimated',unitCost:0,isProvisional:false,condition:'estimated'};assert.equal(eventReport(noCost,f.event.id).stats.metrics.estimatedUnits,2)
 noCost.sales.find(s=>s.status==='completed')!.items[0].cost={source:'average',unitCost:1,isProvisional:true};assert.equal(eventReport(noCost,f.event.id).stats.metrics.provisionalUnits,2)
})
test('Excel y ZIP se reabren, UUID y fórmulas son texto; importes y fechas conservados',async()=>{
 const f=await fixture(),tables=exportTables(f.data),xlsx=await excelFile(tables),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()))
 assert.equal(book.worksheets.length,tables.length);assert.equal(book.getWorksheet('Productos')!.getCell('A2').value,f.product.id);assert.equal(book.getWorksheet('Productos')!.getCell('B2').value,f.product.name);assert.equal(book.getWorksheet('Ventas')!.getCell('E2').type,ExcelJS.ValueType.Date)
 const zip=unzipSync(new Uint8Array(await (await csvArchive(tables)).arrayBuffer()));assert.equal(Object.keys(zip).length,tables.length);assert.match(strFromU8(zip['Productos.csv']),/'=Sticker/)
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/etapa-7-3-QA.xlsx',new Uint8Array(await xlsx.arrayBuffer()));await writeFile('artifacts/etapa-7-3-QA.json',await createBackup(f.data))
})
test('PDF real con logo y tablas; genera un evento sin ventas sin datos ficticios',async()=>{
 const f=await fixture(),logo=new Uint8Array(await readFile('src/assets/branding/matu-art-official.png'))
 const pdf=eventPDF(f.data,f.event.id,logo);assert.equal((await pdf.text()).slice(0,4),'%PDF');assert(pdf.size>1000)
 await writeFile('artifacts/etapa-7-3-QA.pdf',new Uint8Array(await pdf.arrayBuffer()))
 const empty=eventReport(f.data,f.other.id);assert.equal(empty.stats.metrics.revenue,0n);assert.equal(empty.ranking.length,0)
 assert((await eventPDF(f.data,f.other.id,logo).text()).startsWith('%PDF'))
})
test('promociones y combos conservan configuraciones históricas y sobreviven al respaldo',async()=>{
 const name='promobackup-'+id(),catalog=new CatalogRepository(name),sales=new SalesRepository(name),promos=new PromotionRepository(name)
 const p=await catalog.createProduct({id:id(),name:'Sticker',categoryIds:[],price:1000,lowStockThreshold:1,isFavorite:false,initialStock:20})
 const now=new Date().toISOString(),promo={id:id(),name:'Dos',type:'quantity' as const,value:1000,groupQuantity:2,productIds:[p.id],categoryIds:[],familyIds:[],ipIds:[],minimumQuantity:0,minimumAmount:0,isActive:true,isArchived:false,isStackable:false,createdAt:now,updatedAt:now}
 await promos.save(promo)
 const sale=await sales.confirm({operationId:id(),items:[{productId:p.id,quantity:2,unitPrice:1000,expectedRevision:1}],payments:[{method:'cash',amount:1000}]})
 assert(sale.appliedCombos?.length);const data=await readData(name),parsed=await parseBackup(await createBackup(data));assert.deepEqual(parsed.data.sales[0].appliedCombos,JSON.parse(JSON.stringify(sale.appliedCombos)))
 assert.equal(exportTables(parsed.data).find(t=>t.name==='Descuentos aplicados')!.rows[0][7],1000);await catalog.close();await sales.close()
})
test('contorno SVG único y cerrado: eventos arriba/abajo; resultados a los lados',()=>{
 for(const [w,h]of[[170,184],[390,400],[425,600],[600,230]]) for(const axis of ['ends','sides'] as const){const path=ticketPath(w,h,axis);assert(path.endsWith('Z'));assert.equal((path.match(/ A/g)??[]).length,2);assert(!path.includes('NaN'))}
 assert.notEqual(ticketPath(200,300,'ends'),ticketPath(200,300,'sides'))
})
test('exportar, respaldar y restaurar no requieren APIs de red',async()=>{
 const f=await fixture(),original=globalThis.fetch
 globalThis.fetch=()=>Promise.reject(new Error('Red desactivada en prueba'))
 try {
   const text=await createBackup(f.data),target='offline-'+id(),preview=await prepareRestore(text,target)
   await restoreBackup(preview.data,preview.localToken,target)
   const restored=await readData(target),tables=exportTables(restored)
   assert((await csvArchive(tables)).size>0);assert((await excelFile(tables)).size>0)
   assert.equal(snapshotToken(restored),snapshotToken(f.data))
 }finally{globalThis.fetch=original}
})
test('restauración mantiene ventas de cero y permite vender y anular después',async()=>{
 const f=await fixture(),target='sell-restored-'+id(),text=await createBackup(f.data),preview=await prepareRestore(text,target)
 await restoreBackup(preview.data,preview.localToken,target)
 const catalog=new CatalogRepository(target),sales=new SalesRepository(target),old=(await catalog.snapshot()).products[0]
 const p=await catalog.setArchived(old.id,false,old.revision)
 const sale=await sales.confirm({operationId:id(),items:[{productId:p.id,quantity:1,unitPrice:p.price,expectedRevision:p.revision}],generalDiscount:{type:'percentage',value:100},payments:[]})
 assert.equal(sale.total,0);assert.equal(sale.number,3)
 const after=await parseBackup(await createBackup(await readData(target)));assert.equal(after.data.sales.find(s=>s.id===sale.id)!.total,0)
 await sales.voidSale({saleId:sale.id,operationId:id(),reason:'Anulación posterior a restauración',returnStock:true})
 validateData(await readData(target));assert.equal((await catalog.snapshot()).products[0].stock,p.stock)
 await catalog.close();await sales.close()
})
