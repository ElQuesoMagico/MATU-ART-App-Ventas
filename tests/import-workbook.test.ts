import test from 'node:test'
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { importTemplate, readWorkbook } from '../src/services/importing/workbook.ts'
import { readImport } from '../src/services/importing/parse.ts'
import { buildImportPlan } from '../src/services/importing/plan.ts'
import { emptySnapshot } from '../src/services/data/snapshot.ts'
import { readData } from '../src/services/data/snapshot.ts'
import { applyImport } from '../src/services/importing/apply.ts'
test('plantillas CSV y XLSX vacías, encabezados coherentes y múltiples asociaciones opcionales', async () => {
  for (const kind of ['catalog','families','ips','sales'] as const) {
    const csv=await importTemplate(kind,'csv'), excel=await importTemplate(kind,'xlsx')
    assert.ok((await csv.text()).includes(kind==='catalog'?'Categoria':kind==='sales'?'Evento':'Nombre'))
    const book=new ExcelJS.Workbook(); await book.xlsx.load(await excel.arrayBuffer())
    assert.equal(book.worksheets[0].rowCount,1)
  }
  const source=await readImport('catalog','catalog.csv',new TextEncoder().encode('Nombres,Categoria,Ips,Familias,Precios\nNuevo,Sticker,Universo A|Universo B,Colección A|Colección B,500\nOtro,Print,,,0'))
  const plan=buildImportPlan(emptySnapshot(),[source]); assert.equal(plan.issues.length,0); assert.equal(plan.additions.products.length,2); assert.equal(plan.additions.products[0].ipIds?.length,2); assert.deepEqual(plan.additions.products[1].familyIds,[])
})
test('XLSX lee valores, conserva procedencia y rechaza fórmulas sin evaluarlas', async () => {
  const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('Datos')
  sheet.addRow(['Nombres','Categoria','Ips','Familias','Precios']); sheet.addRow(['Artículo','Print','','',1000])
  const bytes=new Uint8Array(await book.xlsx.writeBuffer())
  const source=await readImport('catalog','datos.xlsx',bytes)
  assert.equal(source.rows[0].Precios,'1000'); assert.equal(source.hash,(await readImport('catalog','renombrado.xlsx',bytes)).hash)
  sheet.getCell('E2').value={formula:'1+1',result:2}
  await assert.rejects(readWorkbook(new Uint8Array(await book.xlsx.writeBuffer())), /sin fórmulas/)
})
test('XLSX corrupto o ambiguo se rechaza antes de persistir', async () => {
  await assert.rejects(readWorkbook(new Uint8Array([0,1,2])))
  const book=new ExcelJS.Workbook();book.addWorksheet('A').addRow(['Nombre']);book.addWorksheet('B').addRow(['Nombre'])
  await assert.rejects(readWorkbook(new Uint8Array(await book.xlsx.writeBuffer())),/una sola hoja/)
})
test('importación XLSX atómica persiste y repetir archivo no duplica productos ni clasificaciones', async () => {
  const name=`xlsx-${crypto.randomUUID()}`, book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Datos')
  sheet.addRow(['Nombres','Categoria','Ips','Familias','Precios']);sheet.addRow(['Producto QA','Formato QA','IP QA','Familia QA',2500])
  const source=await readImport('catalog','qa.xlsx',new Uint8Array(await book.xlsx.writeBuffer()))
  const plan=buildImportPlan(await readData(name),[source]);assert.equal(plan.issues.length,0)
  await applyImport(plan,name)
  const after=await readData(name), next=buildImportPlan(after,[source])
  assert.equal(after.products.length,1);assert.equal(after.families.length,1);assert.equal(after.ips.length,1)
  assert.equal(after.products[0].stockCountPending,true);assert.equal(after.movements.length,0)
  assert.equal(next.alreadyImported,1);assert.equal(next.additions.products.length,0)
})
