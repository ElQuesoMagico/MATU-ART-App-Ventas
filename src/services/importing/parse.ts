import type { ImportKind, ImportSource } from '../../types/imports.ts'
const columns:Record<ImportKind,string[]>={catalog:['Nombres','Ips','Familias','Precios'],families:['Nombre'],ips:['Nombre'],sales:['Evento','Fecha','Hora','Producto','Categoria','Cantidad','Precio_Total','Metodo_Pago']}
/** RFC4180 quoting; also accepts semicolon CSV and tab-separated original tables. */
export function parseTable(input:string):Record<string,string>[] {
  const text=input.replace(/^\uFEFF/,'')
  if(text.includes('\ufffd')||text.includes('\0'))throw new Error('Codificación inválida; usa UTF-8.')
  const header=text.split(/\r?\n/)[0]??''
  const delimiter=header.includes('\t')?'\t':header.includes(';')?';':','
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false
  for(let i=0;i<text.length;i++) {
    const c=text[i]
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
    if(c==='"'){if(field||closed)throw new Error('Comillas malformadas.');quoted=true;continue}
    if(c===delimiter){row.push(field);field='';closed=false;continue}
    if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';closed=false;continue}
    if(closed)throw new Error('Texto después de una comilla de cierre.')
    field+=c
  }
  if(quoted)throw new Error('Comillas sin cerrar.')
  if(field||row.length||closed){row.push(field);rows.push(row)}
  if(!rows.length)throw new Error('Archivo vacío.')
  const names=rows.shift()!.map(x=>x.trim())
  if(names.some(x=>!x||['__proto__','constructor','prototype'].includes(x))||new Set(names).size!==names.length)throw new Error('Cabeceras vacías o repetidas.')
  if(rows.length>10000)throw new Error('Máximo 10.000 filas por archivo.')
  return rows.map((cells,index)=>{if(cells.length!==names.length)throw new Error(`Fila ${index+2}: cantidad de columnas incorrecta.`);return Object.fromEntries(names.map((name,i)=>[name,cells[i]]))})
}
export async function readImport(kind:ImportKind,name:string,bytes:Uint8Array):Promise<ImportSource> {
  if(bytes.length>5*1024*1024)throw new Error('Máximo 5 MB por archivo CSV/TSV.')
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),rows=parseTable(text)
  if(!rows.length)throw new Error('No hay filas de datos.')
  if(columns[kind].some(c=>!Object.hasOwn(rows[0],c))||Object.keys(rows[0]).length!==columns[kind].length)throw new Error(`Columnas esperadas: ${columns[kind].join(', ')}.`)
  // Hash the original UTF-8 bytes including BOM/newlines, never the filename.
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('')
  return {kind,name,hash,rows}
}
export function amount(value:string,label:string,positive=false) {
  if(!/^\d+(?:\.0+)?$/.test(value.trim()))throw new Error(`${label}: entero CLP/cantidad inválido.`)
  const number=Number(value)
  if(!Number.isSafeInteger(number)||number>(1e9)||number<(positive?1:0))throw new Error(`${label}: valor fuera de rango.`)
  return number
}
export function categoryFor(name:string,price:number) {
  if(price===600)return 'Stickers'
  for(const [prefix,category] of [['poster ','Posters'],['chapita ','Chapitas'],['charm ','Charms'],['llavero ','Llaveros'],['libreta ','Libretas'],['blind bag ','Blind bags']])if(name.trim().toLowerCase().startsWith(prefix))return category
  return undefined
}
export function chileanInstant(day:string,time:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}:\d{2}$/.test(time))throw new Error('Fecha/hora inválida: usa YYYY-MM-DD y HH:mm:ss.')
  const target=`${day}T${time}`
  const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  const matches=[3,4].map(hours=>new Date(`${target}-0${hours}:00`)).filter(date=>Number.isFinite(date.getTime())&&formatter.format(date).replace(' ','T')===target)
  if(matches.length!==1)throw new Error('Fecha/hora inexistente o ambigua en Chile; requiere revisión.')
  return matches[0].toISOString()
}
