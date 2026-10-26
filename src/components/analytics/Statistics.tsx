import { TicketFrame } from '../TicketFrame'
import type { FinancialMetrics } from '../../services/expenseRules'
import { useId } from 'react'
import type { EventStatistics, Metrics } from '../../services/analytics'
import { money, marginLabel } from '../../utils/format'
import { eventDateRange, eventStatusLabels } from '../../services/eventRules'
import { Ornament } from '../Ornament'
import { EmptyState } from '../ui'

export function CostQuality({ metrics }: { metrics: Metrics }) {
  if (!metrics.transactions) return null
  return <p className={`cost-quality ${metrics.unknownUnits || metrics.provisionalUnits ? 'cost-incomplete' : ''}`}>
    {metrics.unknownUnits > 0 && <span>{metrics.unknownUnits} uds. sin costo · utilidad no disponible.</span>}
    {metrics.provisionalUnits > 0 && <span>{metrics.provisionalUnits} uds. con costo provisional.</span>}
    {metrics.estimatedUnits > 0 && <span>{metrics.estimatedUnits} uds. con costo estimado.</span>}
    {!metrics.unknownUnits && !metrics.provisionalUnits && !metrics.estimatedUnits && <span>Costos históricos completos.</span>}
  </p>
}
export function ProfitValue({ metrics }: { metrics: Metrics }) {
  return <>{metrics.grossProfit === undefined ? 'No disponible' : money(metrics.grossProfit)}{metrics.grossProfit !== undefined && (metrics.provisionalUnits > 0 ? <small>Provisional</small> : metrics.estimatedUnits > 0 ? <small>Costo estimado</small> : null)}</>
}
export function MetricTickets({ metrics, financial }: { metrics: Metrics; financial?: FinancialMetrics }) {
  const values = [
    { label: 'Ingresos', value: money(metrics.revenue), detail: 'CLP · Total cobrado' },
    { label: metrics.historicalRows ? 'Registros de venta' : 'Transacciones', value: metrics.transactions, detail: metrics.historicalRows ? `${metrics.historicalRows} filas históricas; transacciones originales desconocidas` : 'Ventas no anuladas' },
    { label: 'Unidades vendidas', value: metrics.units, detail: 'Cantidades registradas' },
    { label: metrics.historicalRows ? 'Promedio por registro' : 'Ticket promedio', value: money(metrics.averageTicket), detail: 'CLP · Por venta' },
    { label: 'Costo estimado de ventas', value: money(metrics.recordedCost), detail: metrics.unknownUnits ? 'Parcial · Faltan costos' : 'CLP · Copias históricas' },
    { label: 'Utilidad bruta estimada', value: <ProfitValue metrics={metrics} />, detail: 'Ingresos menos costos · Sin gastos' },
    ...(financial ? [
      { label: 'Gastos', value: money(financial.expenses), detail: 'CLP · Gastos activos del contexto' },
      { label: 'Utilidad neta estimada', value: <NetProfit metrics={metrics} financial={financial} />, detail: 'Utilidad bruta menos gastos' },
      { label: 'Margen neto', value: marginLabel(financial.netMargin), detail: 'Utilidad neta / ingresos' },
    ] : []),
  ]
  return <><div className="analytics-tickets">{values.map((value, index) => <article key={value.label} className={`metric ticket-shaped ${['peach', 'lavender', 'butter', 'mint', 'lavender', 'peach'][index % 6]}`}><TicketFrame notch={8} /><div className="ticket-stub" aria-hidden="true"><span>RESUMEN</span><Ornament size={12} /><span>N.º {String(index + 1).padStart(2, '0')}</span></div><div className="ticket-content"><span>{value.label}</span><strong>{value.value}</strong><p>{value.detail}</p></div></article>)}</div><CostQuality metrics={metrics} /></>
}
export function CompactMetrics({ metrics }: { metrics: Metrics }) {
  return <><dl className="compact-metrics"><div><dt>Ingresos</dt><dd>{money(metrics.revenue)}</dd></div><div><dt>{metrics.historicalRows?'Registros de venta':'Ventas'}</dt><dd>{metrics.transactions}</dd></div><div><dt>Unidades</dt><dd>{metrics.units}</dd></div><div><dt>{metrics.historicalRows?'Promedio por registro':'Ticket promedio'}</dt><dd>{money(metrics.averageTicket)}</dd></div><div className="profit-metric"><dt>Utilidad bruta estimada</dt><dd><ProfitValue metrics={metrics} /></dd></div></dl><CostQuality metrics={metrics} /></>
}
export function EventStatisticsCard({ stats, onOpen }: { stats: EventStatistics; onOpen: (id: string) => void }) {
  return <article className="panel analytics-event-card ticket-shaped"><TicketFrame /><header><span className="badge neutral">{stats.event ? eventStatusLabels[stats.event.status] : 'Referencia histórica'}</span>{!stats.metrics.transactions && <span className="badge neutral">Sin ventas válidas</span>}<h3>{stats.name}</h3><p className="muted">{stats.event ? eventDateRange(stats.event) : 'Fechas planificadas no disponibles'}</p></header><CompactMetrics metrics={stats.metrics} /><FinancialNumbers metrics={stats.metrics} financial={stats.financial} /><button className="button secondary" onClick={() => onOpen(stats.id)} aria-label={`Estadísticas de ${stats.name}`}>Ver estadísticas</button></article>
}
export interface ChartRow { id: string; label: string; value: bigint; display: string; onSelect?: () => void }
/** Data-driven HTML chart: exact values are visible and keyboard-accessible. */
export function BarChart({ title, rows, unit, emptyTitle = 'Sin ventas registradas', emptyDescription = 'Los resultados aparecerán cuando registres ventas en este contexto.' }: { title: string; rows: ChartRow[]; unit: string; emptyTitle?: string; emptyDescription?: string }) {
  const id = useId()
  const max = rows.reduce((largest, row) => { const value = row.value < 0n ? -row.value : row.value; return value > largest ? value : largest }, 0n)
  return <section className="panel chart-panel" aria-labelledby={id}><div className="section-heading"><h2 id={id}>{title}</h2><span className="badge neutral">{unit}</span></div>{rows.length ? <ol className="bar-chart">{rows.map(row => {
    const absolute = row.value < 0n ? -row.value : row.value
    const width = max ? Number(absolute * 10_000n / max) / 100 : 0
    return <li key={row.id}><div className="bar-label">{row.onSelect ? <button className="text-button" onClick={row.onSelect}>{row.label}</button> : <span>{row.label}</span>}<strong>{row.display}</strong></div><div className="bar-track" aria-hidden="true"><div className={`bar-fill ${row.value < 0n ? 'bar-negative' : ''}`} style={{ width: `${width}%` }} /></div></li>
  })}</ol> : <EmptyState title={emptyTitle} description={emptyDescription} />}</section>
}

export function NetProfit({ metrics, financial }: { metrics: Metrics; financial: FinancialMetrics }) {
 return <>{financial.netProfit === undefined ? 'No disponible' : money(financial.netProfit)}{financial.netProfit !== undefined && (metrics.provisionalUnits ? <small>Provisional</small> : metrics.estimatedUnits ? <small>Costo estimado</small> : null)}</>
}
export function FinancialNumbers({ metrics, financial }: { metrics: Metrics; financial: FinancialMetrics }) {
 return <dl className="compact-metrics financial-numbers"><div><dt>Gastos</dt><dd>{money(financial.expenses)}</dd></div><div><dt>Utilidad neta estimada</dt><dd><NetProfit metrics={metrics} financial={financial} /></dd></div><div><dt>Margen neto</dt><dd>{marginLabel(financial.netMargin)}</dd></div></dl>
}
