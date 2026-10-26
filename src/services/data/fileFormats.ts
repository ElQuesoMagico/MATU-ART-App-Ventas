import type { DataTable } from './exportTables.ts'
import { toCSV } from './exportTables.ts'

export async function csvArchive(tables:DataTable[]) {
  const {zipSync,strToU8}=await import('fflate')
  return new Blob([new Uint8Array(zipSync(Object.fromEntries(tables.map(t=>[`${t.name}.csv`,strToU8(toCSV(t))]))))],{type:'application/zip'})
}
export async function excelFile(tables:DataTable[]) {
  const {default:ExcelJS}=await import('exceljs')
  const book=new ExcelJS.Workbook(); book.creator='MATU ART'; book.created=new Date()
  for(const t of tables) {
    if(t.rows.length>200_000) throw new Error('La hoja supera el límite de 200.000 filas. Reduce el período de exportación.')
    const sheet=book.addWorksheet(t.name,{views:[{state:'frozen',ySplit:1}],properties:{tabColor:{argb:'FFE89DAF'}}})
    sheet.columns=t.columns.map((header,index)=>({header,key:String(index),width:header.includes('UUID')?38:header.includes('Fecha')?26:24}))
    sheet.getRow(1).font={bold:true,color:{argb:'FF342631'}}; sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF7D7DF'}}; sheet.getRow(1).height=30
    for(const row of t.rows) {
      if(row.some(cell=>typeof cell==='string'&&cell.length>32767)) throw new Error(`Un registro de «${t.name}» supera el límite de texto de Excel. Usa el CSV o el respaldo JSON; no se truncaron datos.`)
      // ExcelJS string cells cannot be interpreted as formulas, including leading '='.
      const saved=sheet.addRow(row.map((cell,index)=>typeof cell==='string'&&/^\d{4}-\d\d-\d\d(T.*)?$/.test(cell)&&/Fecha|Creado|Modificado|Inicio|Fin|Día/.test(t.columns[index])?new Date(cell.length===10?cell+'T00:00:00Z':cell):cell??''))
      saved.eachCell((cell,index)=>{ const header=t.columns[index-1]; cell.alignment={vertical:'top',wrapText:true}; if(header.includes('UUID')) cell.numFmt='@'; else if(cell.value instanceof Date) cell.numFmt=header.includes('UTC')?'yyyy-mm-dd hh:mm:ss "UTC"':'yyyy-mm-dd'; else if(typeof cell.value==='number') cell.numFmt=header.includes('CLP')?'"$"#,##0;[Red]-"$"#,##0':header.includes('%')?'0.00':'0.##' })
    }
    sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:t.columns.length}}
  }
  return new Blob([new Uint8Array(await book.xlsx.writeBuffer())],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}
