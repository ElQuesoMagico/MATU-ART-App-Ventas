import { unzipSync } from 'fflate'
import type { ImportKind } from '../../types/imports.ts'
import { importColumns, parseTable } from './parse.ts'

export async function readWorkbook(bytes: Uint8Array): Promise<Record<string,string>[]> {
  let expanded = 0, entries = 0
  // Inspect ZIP directory sizes without inflating entries before ExcelJS loads it.
  unzipSync(bytes, { filter: file => {
    expanded += file.originalSize; entries++
    if (expanded > 25 * 1024 * 1024 || entries > 2000) throw new Error('El Excel descomprimido supera los límites (25 MB / 2.000 archivos internos).')
    if (/vbaProject|externalLinks/i.test(file.name)) throw new Error('No se admiten macros ni vínculos externos.')
    return false
  } })
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(new Uint8Array(bytes).buffer)
  const sheets = book.worksheets.filter(sheet => sheet.actualRowCount > 0)
  if (sheets.length !== 1) throw new Error('Usa un archivo con una sola hoja de datos por tipo de entidad.')
  const sheet = sheets[0]
  if (sheet.rowCount > 10001 || sheet.columnCount > 20) throw new Error('Máximo 10.000 filas y 20 columnas.')
  const lines: string[] = []
  for (let index = 1; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index)
    const cells: string[] = []
    for (let col = 1; col <= sheet.columnCount; col++) {
      const value = row.getCell(col).value
      if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number') throw new Error(`Fila ${index}, columna ${col}: usa texto o números simples, sin fórmulas, fechas automáticas ni enlaces.`)
      const text = String(value ?? '')
      if (text.length > 32767) throw new Error('Celda demasiado extensa.')
      cells.push(`"${text.replaceAll('"','""')}"`)
    }
    lines.push(cells.join(','))
  }
  return parseTable(lines.join('\n'))
}
export async function importTemplate(kind: ImportKind, format: 'csv' | 'xlsx'): Promise<Blob> {
  const headers = kind === 'catalog' ? ['Nombres','Categoria','Ips','Familias','Precios'] : importColumns[kind]
  if (format === 'csv') return new Blob(['\uFEFF' + headers.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' })
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Datos', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = headers.map(header => ({ header, width: 25, style: { numFmt: '@' } }))
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb:'FFF7D7DF' } }
  return new Blob([new Uint8Array(await book.xlsx.writeBuffer())], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
