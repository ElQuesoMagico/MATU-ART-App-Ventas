import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { DataSnapshot } from './snapshot.ts'
import { eventReport } from './exportTables.ts'
import { money, marginLabel } from '../../utils/format.ts'
import { eventStatusLabels } from '../eventRules.ts'

export function eventPDF(data:DataSnapshot,eventId:string,logo:Uint8Array):Blob {
  const report=eventReport(data,eventId), {stats}=report, m=stats.metrics, f=stats.financial
  const doc=new jsPDF({unit:'mm',format:'a4',compress:true})
  doc.setProperties({title:`MATU ART - ${stats.name}`,author:'MATU ART',subject:'Informe financiero por evento'})
  doc.setFillColor('#FFF8EE');doc.rect(0,0,210,297,'F')
  doc.setFillColor('#F7D7DF');doc.circle(179,28,17,'F');doc.addImage(logo,'PNG',160,9,38,38)
  doc.setFont('times','bold');doc.setFontSize(25);doc.setTextColor('#A83F58');doc.text('MATU ART',16,23)
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor('#342631');doc.text('Informe financiero por evento · CLP',16,32)
  const lines=doc.splitTextToSize(stats.name,135) as string[]
  doc.setFont('times','bold');doc.setFontSize(19);doc.text(lines,16,45)
  let y=49+lines.length*7
  doc.setFont('helvetica','normal');doc.setFontSize(10)
  doc.text(stats.event?`${stats.event.startDate} a ${stats.event.endDate} · ${eventStatusLabels[stats.event.status]}`:'Referencia histórica · Fechas no disponibles',16,y);y+=8
  const quality=[m.unknownUnits?`${m.unknownUnits} unidades sin costo. Utilidades no disponibles.`:'',m.provisionalUnits?`${m.provisionalUnits} unidades con costo provisional.`:'',m.estimatedUnits?`${m.estimatedUnits} unidades con costo estimado.`:''].filter(Boolean).join(' ')||'Costos históricos completos.'
  const notes=doc.splitTextToSize(quality,178) as string[];doc.text(notes,16,y);y+=notes.length*5+5
  function section(title:string,head:string[],body:string[][]) {
    // Keep small financial tables with their heading; long rankings repeat headers.
    if(y+12+(Math.min(body.length,8)+1)*10>277) {doc.addPage();y=22}
    doc.setFont('times','bold');doc.setFontSize(14);doc.setTextColor('#A83F58');doc.text(title,16,y);y+=4
    autoTable(doc,{startY:y,head:[head],body:body.length?body:[head.map((_,i)=>i===0?'Sin registros':'')],margin:{top:20,left:16,right:16,bottom:20},styles:{font:'helvetica',fontSize:9,cellPadding:3,textColor:'#342631',overflow:'linebreak'},headStyles:{fillColor:'#E89DAF',textColor:'#342631'},alternateRowStyles:{fillColor:'#FFF8EE'},rowPageBreak:'avoid',didDrawPage:info=>{y=info.cursor?.y??y}})
    y+=12
  }
  section('Resultados',['Indicador','Importe / cantidad'],[
    ['Ingresos por ventas válidas',money(m.revenue)],['Transacciones',String(m.transactions)],['Unidades vendidas',String(m.units)],['Ticket promedio',money(m.averageTicket)],['Costo de productos vendidos'+(m.unknownUnits?' (parcial)':''),money(m.recordedCost)],['Utilidad bruta estimada',m.grossProfit===undefined?'No disponible':money(m.grossProfit)],['Gastos del evento',money(f.expenses)],['Utilidad neta estimada',f.netProfit===undefined?'No disponible':money(f.netProfit)],['Margen neto estimado',marginLabel(f.netMargin)],
  ])
  section('Productos más vendidos',['Producto histórico','Unidades','Ingresos CLP'],report.ranking.map(r=>[r.name,String(r.metrics.units),money(r.metrics.revenue)]))
  section('Descuentos incluidos en las ventas',['Origen','Importe CLP'],[['Manuales',money(report.manual)],['Promociones automáticas',money(report.automatic)],['Combos y grupos',money(report.combos)],['Total registrado (no restar otra vez)',money(report.discounts)]])
  section('Distribución de pagos',['Método','Importe CLP'],[['Efectivo',money(report.payments.cash)],['Transferencia',money(report.payments.transfer)],['Débito',money(report.payments.debit)]])
  section('Gastos asociados',['Fecha','Concepto','Importe CLP'],report.expenses.map(e=>[e.date,e.concept,money(e.amount)]))
  const explanation=(report.stats.metrics.historicalRows ? 'Incluye filas históricas independientes: no se conoce el número de transacciones originales; ticket promedio es promedio por registro. ' : '')+'Ventas y gastos anulados excluidos. Los pagos distribuyen los ingresos; no se suman nuevamente. Los descuentos ya están incluidos. Utilidad neta = ingresos menos costos históricos y gastos del evento. No se asignan gastos globales. Este informe no representa flujo de caja.'
  section('Criterios',['Método'],[[explanation],[quality]])
  for(let page=1;page<=doc.getNumberOfPages();page++) {doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor('#68525F');doc.text(`MATU ART · ${page} / ${doc.getNumberOfPages()}`,16,288);doc.text(`Generado ${new Date().toISOString().slice(0,10)} UTC`,194,288,{align:'right'})}
  return doc.output('blob')
}
