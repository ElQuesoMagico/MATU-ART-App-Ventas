import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync,existsSync } from 'node:fs'
import { openDB } from 'idb'
import { readImport,parseTable,categoryFor,chileanInstant } from '../src/services/importing/parse.ts'
import { reviewedChoices } from '../src/services/importing/reviewed.ts'
import { buildImportPlan } from '../src/services/importing/plan.ts'
import { applyImport } from '../src/services/importing/apply.ts'
import { readData,emptySnapshot,snapshotToken,canonical } from '../src/services/data/snapshot.ts'
import { createBackup,parseBackup,restoreBackup,digest } from '../src/services/data/backup.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { buildAnalytics } from '../src/services/analytics.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
const catalog='Nombres,Ips,Familias,Precios\nSans,Undertale,Juegos,600\nPoster Sans,Undertale,Juegos,2500\n'
const sales='Evento,Fecha,Hora,Producto,Categoria,Cantidad,Precio_Total,Metodo_Pago\nFeria,2026-08-22,13:45:00,Sans,Stickers,1,500.0,Efectivo\nFeria,2026-08-22,13:45:00,Sans,Stickers,1,500.0,Efectivo\n'
const source=(kind:'catalog'|'sales'|'families'|'ips',text:string)=>readImport(kind,kind+'.csv',new TextEncoder().encode(text))
const dbName=()=>`import-qa-${crypto.randomUUID()}`
test('import CSV: UTF8, BOM, delimiters, quotes and multiline; malformed rejected',async()=>{
  assert.equal(parseTable('\ufeffNombre;Otro\n"niño; azul";"dos\nfilas"\n')[0].Otro,'dos\nfilas')
  assert.equal(parseTable('Nombre\tOtro\n"Doble ""comilla"""\tx')[0].Nombre,'Doble "comilla"')
  for(const text of ['a,a\nx,x','a,b\nx','a\n"x','a\n"x"z','a\na"x','a\n\ufffd'])assert.throws(()=>parseTable(text))
  await assert.rejects(source('catalog','Nombre\nSans'))
  await assert.rejects(readImport('catalog','bad.csv',new Uint8Array([255])))
})
test('import classification: confirmed 600 rule and explicit physical prefixes only',()=>{
  assert.equal(categoryFor('Anything',600),'Stickers')
  for(const [name,expected] of [['Poster X','Posters'],['Chapita X','Chapitas'],['Charm X','Charms'],['Llavero X','Llaveros'],['Libreta X','Libretas'],['Blind bag X','Blind bags']])assert.equal(categoryFor(name,2500),expected)
  assert.equal(categoryFor('Unknown',1000),undefined)
})
test('import dates: Chile DST, no UTC assumption; invalid and skipped times rejected',()=>{
  assert.equal(chileanInstant('2026-08-22','13:45:00'),'2026-08-22T17:45:00.000Z')
  assert.equal(chileanInstant('2026-09-06','13:45:00'),'2026-09-06T16:45:00.000Z')
  assert.throws(()=>chileanInstant('2026-02-30','12:00:00'))
  assert.throws(()=>chileanInstant('2026-09-06','00:30:00'))
})
test('import invalid amounts, dates, blanks and payment methods block confirmation',async()=>{
  for(const bad of [catalog.replace('600','-1'),catalog.replace('600','1.5'),catalog.replace('Sans,',' ,')])assert.ok(buildImportPlan(emptySnapshot(),[await source('catalog',bad)]).issues.length)
  for(const bad of [sales.replaceAll('Efectivo','Unknown'),sales.replaceAll('2026-08-22','not-a-date'),sales.replaceAll('500.0','-1')])assert.ok(buildImportPlan(emptySnapshot(),[await source('catalog',catalog),await source('sales',bad)]).issues.length)
})
test('import preserves families/IP associations, duplicate classifications and source originals',async()=>{
  const plan=buildImportPlan(emptySnapshot(),[await source('ips','Nombre\nWalten\nwalten\nWalten\n'),await source('families','Nombre\nMemes\nMemes\n'),await source('catalog','Nombres,Ips,Familias,Precios\nCharm Teto pera,Voicebank,Memes,3000\n')])
  assert.equal(plan.additions.ips.length,2);assert.equal(plan.additions.families.length,1)
  assert.ok(plan.additions.importRecords.some(r=>r.original.Nombre==='walten'))
  assert.equal(plan.additions.products[0].familyIds?.[0],plan.additions.families[0].id)
})
test('import is atomic, repeatable, historical rows independent and stock/costs unknown',async()=>{
  const name=dbName(),sources=[await source('catalog',catalog),await source('sales',sales)]
  const before=await readData(name),plan=buildImportPlan(before,sources)
  assert.equal(plan.issues.length,0);assert.equal(plan.additions.sales.length,2)
  assert.equal(plan.additions.sales[0].soldAt,plan.additions.sales[1].soldAt)
  assert.notEqual(plan.additions.sales[0].id,plan.additions.sales[1].id)
  const oldFetch=globalThis.fetch
  try{globalThis.fetch=async()=>{throw new Error('offline')};await applyImport(plan,name)}finally{globalThis.fetch=oldFetch}
  const after=await readData(name)
  assert.equal(after.products.length,2);assert.ok(after.products.every(p=>p.stockCountPending&&p.stock===0&&p.averageCost===undefined))
  assert.equal(after.movements.length,0);assert.equal(after.sales.length,2);assert.equal(after.managedEvents[0].status,'finished')
  const second=buildImportPlan(after,sources)
  assert.equal(second.additions.products.length,0);assert.equal(second.additions.sales.length,0)
  const metrics=buildAnalytics(after.sales,after.managedEvents).events[0].metrics
  assert.equal(metrics.revenue,1000n);assert.equal(metrics.units,2);assert.equal(metrics.grossProfit,undefined);assert.equal(metrics.historicalRows,2)
  const backup=await createBackup(after),parsed=await parseBackup(backup),other=dbName()
  await restoreBackup(parsed.data,snapshotToken(await readData(other)),other)
  assert.equal(snapshotToken(await readData(other)),snapshotToken(after))
})
test('import reuses UUID and preserves existing stock/cost/price/archive; conflicts require choice',async()=>{
  const name=dbName(),repo=new CatalogRepository(name)
  const p=await repo.createProduct({id:crypto.randomUUID(),name:'Sans',categoryIds:[],price:900,initialStock:7,initialCost:100,lowStockThreshold:1,isFavorite:false})
  const sources=[await source('catalog',catalog)],data=await readData(name),first=buildImportPlan(data,sources)
  assert.equal(first.issues.length,1)
  const plan=buildImportPlan(data,sources,{[first.issues[0].key]:p.id})
  assert.equal(plan.issues.length,0);await applyImport(plan,name)
  assert.deepEqual((await readData(name)).products.find(x=>x.id===p.id),p)
  await repo.close()
})
test('import rejects invalid plans and stale previews',async()=>{
  const name=dbName(),sources=[await source('catalog',catalog)],before=await readData(name),plan=buildImportPlan(before,sources)
  plan.additions.products.push({...plan.additions.products[0],id:crypto.randomUUID()})
  await assert.rejects(applyImport(plan,name));assert.equal(snapshotToken(await readData(name)),snapshotToken(before))
  const fresh=buildImportPlan(before,sources);await applyImport(fresh,name)
  await assert.rejects(applyImport(fresh,name),/cambiaron/)
})
test('imported historical void never returns stock; initial physical count establishes baseline',async()=>{
  const name=dbName(),sources=[await source('catalog',catalog),await source('sales',sales)]
  await applyImport(buildImportPlan(await readData(name),sources),name)
  const data=await readData(name),repo=new CatalogRepository(name),salesRepo=new SalesRepository(name)
  await assert.rejects(salesRepo.voidSale({saleId:data.sales[0].id,operationId:crypto.randomUUID(),reason:'corrección',returnStock:true}),/no descontó/)
  await salesRepo.voidSale({saleId:data.sales[0].id,operationId:crypto.randomUUID(),reason:'corrección',returnStock:false})
  assert.equal((await readData(name)).movements.length,0)
  const p=data.products[0]
  await assert.rejects(repo.recordMovement({id:crypto.randomUUID(),productId:p.id,type:'restock',quantity:2,expectedRevision:p.revision}),/conteo/)
  await repo.recordMovement({id:crypto.randomUUID(),productId:p.id,type:'count',quantity:0,expectedRevision:p.revision})
  const after=await readData(name);assert.equal(after.products.find(x=>x.id===p.id)?.stockCountPending,false);assert.equal(after.movements[0].previousStockUnknown,true)
  await repo.close();await salesRepo.close()
})
test('migration v9 to v10 preserves old rows and v9 backups have explicit additive adapter',async()=>{
  const name=dbName(),db=await openDB(name,9,{upgrade(db){db.createObjectStore('products',{keyPath:'id'})}});db.close()
  const migrated=await openCatalogDatabase(name);assert.equal(migrated.version,10);assert.ok(migrated.objectStoreNames.contains('importRecords'));migrated.close()
  const old=JSON.parse(await createBackup(await readData(dbName())));delete old.data.importRecords;delete old.counts.importRecords;old.databaseVersion=9
  const {sha256:_hash,...body}=old;old.sha256=await digest(canonical(body))
  assert.deepEqual((await parseBackup(JSON.stringify(old))).data.importRecords,[])
})
test('real provided catalog and original sales CSV analyzed without importing user DB',async t=>{
  const path='C:/Users/4riel/Downloads/registro_ventas_unificado.csv'
  if(!existsSync(path)){t.skip('Original user file not on this host');return}
  const s=await readImport('sales','registro_ventas_unificado.csv',new Uint8Array(readFileSync(path)))
  assert.equal(s.hash,'0fd952883c152f230ad0c15da65455e98d2adbc614cc3c6560f309b44a1c72d8')
  const c=await readImport('catalog','catalogo-maestro.tsv',new Uint8Array(readFileSync(new URL('../docs/import-sources/catalogo-maestro.tsv',import.meta.url))))
  assert.equal(c.rows.length,77);assert.equal(s.rows.length,150)
  assert.equal(s.rows.reduce((n,r)=>n+Number(r.Precio_Total),0),192400)
  const plan=buildImportPlan(emptySnapshot(),[c,s]);assert.equal(plan.additions.sales.length,139);assert.equal(plan.issues.length,10)
  const identities={}, preview=buildImportPlan(emptySnapshot(),[c,s],{},identities), reviewed=buildImportPlan(emptySnapshot(),[c,s],reviewedChoices([s],preview.additions.products),identities)
  assert.equal(reviewed.issues.length,0);assert.equal(reviewed.deferredRows,3);assert.equal(reviewed.additions.sales.length,147)
  assert.deepEqual(reviewedChoices([{...s,hash:'0'.repeat(64)}],preview.additions.products),{})
  const name=dbName(),base=await readData(name),ids={},initial=buildImportPlan(base,[c,s],{},ids)
  const ready=buildImportPlan(base,[c,s],reviewedChoices([s],initial.additions.products),ids)
  await applyImport(ready,name)
  const persisted=await readData(name)
  assert.equal(persisted.sales.length,147);assert.equal(persisted.movements.length,0)
  assert.equal(persisted.sales.reduce((sum,sale)=>sum+sale.total,0),184400)
  const repeated=buildImportPlan(persisted,[c,s],reviewedChoices([s],persisted.products))
  assert.equal(repeated.additions.sales.length,0);assert.equal(repeated.deferredRows,3)
  assert.equal(repeated.additions.products.length,0)
  await parseBackup(await createBackup(persisted))

})


test('import quota failure after writes aborts the whole transaction',async()=>{
  const name=dbName(),before=await readData(name),plan=buildImportPlan(before,[await source('catalog',catalog),await source('sales',sales)])
  const original=IDBObjectStore.prototype.add
  let writes=0
  IDBObjectStore.prototype.add=function(value:unknown,key?:IDBValidKey){
    writes++
    if(this.name==='sales')throw new DOMException('Full','QuotaExceededError')
    return original.call(this,value,key)
  }
  try{await assert.rejects(applyImport(plan,name),{name:'QuotaExceededError'})}finally{IDBObjectStore.prototype.add=original}
  assert.ok(writes>1);assert.equal(snapshotToken(await readData(name)),snapshotToken(before))
})

test('preview choices keep stable UUIDs and resolve historical aliases explicitly',async()=>{
  const sources=[await source('catalog',catalog),await source('sales',sales.replaceAll('Sans,Stickers','Alias,Stickers'))],identities={}
  const first=buildImportPlan(emptySnapshot(),sources,{},identities)
  const id=first.additions.products[0].id
  const second=buildImportPlan(emptySnapshot(),sources,{[first.issues[0].key]:id},identities)
  assert.equal(second.issues.length,0);assert.equal(second.additions.sales[0].items[0].productId,id)
  assert.equal(second.additions.sales[0].items[0].name,'Alias')
})
