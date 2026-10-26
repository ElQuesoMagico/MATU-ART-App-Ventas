import type { Expense } from '../types/expenses.ts'
import { financialMetrics, type FinancialMetrics } from './expenseRules.ts'
import type { StoredSale, StoredSaleItem } from '../types/sales.ts'
import type { CatalogEvent } from '../types/events.ts'
import { santiagoDay } from '../utils/format.ts'

export interface Metrics {
  revenue: bigint
  transactions: number
  historicalRows?: number
  units: number
  recordedCost: bigint
  unknownUnits: number
  provisionalUnits: number
  estimatedUnits: number
  uncertainSales: number
  averageTicket: bigint
  grossProfit?: bigint
}
export interface AnalyticalSale { sale: StoredSale; day: string; lineRevenues: bigint[] }
export interface EventStatistics { id: string; name: string; event?: CatalogEvent; lastSale?: string; records: AnalyticalSale[]; metrics: Metrics; financial: FinancialMetrics }
export type RankingOrder = 'units' | 'revenue' | 'profit'
export interface ProductStatistics { id: string; name: string; historicalNames: string[]; metrics: Metrics; share: number }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const emptyMetrics = (): Metrics => ({ revenue: 0n, transactions: 0, units: 0, recordedCost: 0n, unknownUnits: 0, provisionalUnits: 0, estimatedUnits: 0, uncertainSales: 0, averageTicket: 0n, grossProfit: 0n })

/** Allocate the recorded final total; never re-run prices, discounts or promotions.
 * General discounts use largest remainders, with product UUID then line order ties.
 * Older receipts without netLineTotal fall back to their own historical amounts.
 */
export function historicalLineRevenues(sale: StoredSale): bigint[] {
  const weights = sale.items.map(item => BigInt(item.netLineTotal ?? Math.max(0, item.lineTotal - (item.appliedDiscount?.amount ?? 0) - (item.promotionDiscount ?? 0))))
  const base = weights.reduce((sum, amount) => sum + amount, 0n)
  if (base === 0n) {
    if (sale.total !== 0) throw new Error(`La venta ${sale.number} no permite distribuir su total histórico.`)
    return weights.map(() => 0n)
  }
  const total = BigInt(sale.total)
  const rows = weights.map((weight, index) => ({ index, amount: total * weight / base, remainder: total * weight % base }))
  let remaining = total - rows.reduce((sum, row) => sum + row.amount, 0n)
  const priority = [...rows].sort((a, b) => a.remainder === b.remainder ? compare(sale.items[a.index].productId, sale.items[b.index].productId) || a.index - b.index : a.remainder > b.remainder ? -1 : 1)
  for (const row of priority) if (remaining > 0n) { row.amount++; remaining-- }
  return rows.map(row => row.amount)
}
function addCost(metrics: Metrics, item: StoredSaleItem) {
  const cost = item.cost
  metrics.units += item.quantity
  if (cost.unitCost === undefined || cost.condition === 'unknown' || cost.source === 'unknown') metrics.unknownUnits += item.quantity
  else {
    metrics.recordedCost += BigInt(cost.unitCost) * BigInt(item.quantity)
    if (cost.isProvisional || cost.condition === 'provisional') metrics.provisionalUnits += item.quantity
    else if (cost.condition === 'estimated' || cost.source === 'estimated') metrics.estimatedUnits += item.quantity
  }
}
function finish(metrics: Metrics): Metrics {
  metrics.averageTicket = metrics.transactions ? (metrics.revenue * 2n + BigInt(metrics.transactions)) / (2n * BigInt(metrics.transactions)) : 0n
  metrics.grossProfit = metrics.unknownUnits ? undefined : metrics.revenue - metrics.recordedCost
  return metrics
}
export function summarizeSales(records: readonly AnalyticalSale[]): Metrics {
  const metrics = emptyMetrics()
  for (const { sale } of records) {
    metrics.revenue += BigInt(sale.total)
    metrics.transactions++
    if(sale.historicalSource)metrics.historicalRows=(metrics.historicalRows??0)+1
    const before = metrics.unknownUnits + metrics.provisionalUnits + metrics.estimatedUnits
    sale.items.forEach(item => addCost(metrics, item))
    if (metrics.unknownUnits + metrics.provisionalUnits + metrics.estimatedUnits > before) metrics.uncertainSales++
  }
  return finish(metrics)
}
/** One pass over the existing provider snapshot; no IndexedDB writes or reads. */
export function buildAnalytics(sales: readonly StoredSale[], events: readonly CatalogEvent[], expenses: readonly Expense[] = []) {
  const expenseGroups = new Map<string, Expense[]>()
  for (const expense of expenses) if (expense.status === 'active' && expense.eventId) { const group = expenseGroups.get(expense.eventId) ?? []; group.push(expense); expenseGroups.set(expense.eventId, group) }
  const records: AnalyticalSale[] = []
  const byEvent = new Map<string, AnalyticalSale[]>()
  for (const sale of sales) {
    if (sale.status !== 'completed') continue
    const record = { sale, day: santiagoDay(sale.soldAt), lineRevenues: historicalLineRevenues(sale) }
    records.push(record)
    if (sale.event) { const group = byEvent.get(sale.event.id) ?? []; group.push(record); byEvent.set(sale.event.id, group) }
  }
  const definitions = new Map(events.map(event => [event.id, { id: event.id, name: event.name, event } as Pick<EventStatistics, 'id' | 'name' | 'event'>]))
  // Also retain legacy event references, including those with only voided receipts.
  for (const sale of [...sales].sort((a, b) => compare(b.soldAt, a.soldAt) || compare(a.id, b.id))) if (sale.event && !definitions.has(sale.event.id)) definitions.set(sale.event.id, { ...sale.event })
  const eventStatistics = [...definitions.values()].map(definition => {
    const group = byEvent.get(definition.id) ?? []
    const lastSale = group.reduce<string | undefined>((last, record) => !last || record.sale.soldAt > last ? record.sale.soldAt : last, undefined)
    const metrics = summarizeSales(group)
    return { ...definition, records: group, lastSale, metrics, financial: financialMetrics(metrics, expenseGroups.get(definition.id) ?? []) }
  }).sort((a, b) => compare(b.lastSale ?? '', a.lastSale ?? '') || compare(b.event?.endDate ?? '', a.event?.endDate ?? '') || compare(a.id, b.id))
  return { records, events: eventStatistics, metrics: summarizeSales(records) }
}
export function filterAnalytics(records: readonly AnalyticalSale[], filter: { eventId?: string; start?: string; end?: string }) {
  return records.filter(record => (!filter.eventId || (filter.eventId === 'none' ? !record.sale.event : record.sale.event?.id === filter.eventId)) && (!filter.start || record.day >= filter.start) && (!filter.end || record.day <= filter.end))
}

/** Calendar window is paged, so even long events never allocate thousands of empty rows.
 * Actual sales outside the planned dates are preserved and shown separately. */
export function eventDayStatistics(records: readonly AnalyticalSale[], event?: Pick<CatalogEvent, 'startDate' | 'endDate'>, offset = 0, limit = 31) {
  const groups = new Map<string, AnalyticalSale[]>()
  for (const record of records) { const group = groups.get(record.day) ?? []; group.push(record); groups.set(record.day, group) }
  const actualDays = [...groups.keys()].sort()
  const start = event?.startDate ?? actualDays[0]
  const end = event?.endDate ?? actualDays.at(-1)
  const startTime = start ? Date.parse(`${start}T00:00:00Z`) : 0
  const dayCount = start && end ? Math.round((Date.parse(`${end}T00:00:00Z`) - startTime) / 86_400_000) + 1 : 0
  const days = Array.from({ length: Math.max(0, Math.min(limit, dayCount - offset)) }, (_, index) => new Date(startTime + (offset + index) * 86_400_000).toISOString().slice(0, 10))
  const result = (day: string) => ({ day, metrics: summarizeSales(groups.get(day) ?? []) })
  return { dayCount, days: days.map(result), outside: actualDays.filter(day => !!start && !!end && (day < start || day > end)).map(result) }
}
export function rankProducts(records: readonly AnalyticalSale[], order: RankingOrder = 'units'): ProductStatistics[] {
  const products = new Map<string, { id: string; name: string; names: Set<string>; latest: string; metrics: Metrics }>()
  let total = 0n
  for (const { sale, lineRevenues } of records) {
    total += BigInt(sale.total)
    sale.items.forEach((item, index) => {
      const key = `${sale.soldAt}|${sale.id}`
      const row = products.get(item.productId) ?? { id: item.productId, name: item.name, names: new Set<string>(), latest: key, metrics: emptyMetrics() }
      row.names.add(item.name)
      if (key > row.latest) { row.name = item.name; row.latest = key }
      row.metrics.revenue += lineRevenues[index]
      row.metrics.transactions++
      if(sale.historicalSource)row.metrics.historicalRows=(row.metrics.historicalRows??0)+1
      addCost(row.metrics, item)
      products.set(item.productId, row)
    })
  }
  return [...products.values()].map(row => ({ id: row.id, name: row.name, historicalNames: [...row.names].sort(), metrics: finish(row.metrics), share: total ? Number((row.metrics.revenue * 20_000n + total) / (total * 2n)) / 100 : 0 })).sort((a, b) => {
    const av = order === 'units' ? BigInt(a.metrics.units) : order === 'revenue' ? a.metrics.revenue : a.metrics.grossProfit
    const bv = order === 'units' ? BigInt(b.metrics.units) : order === 'revenue' ? b.metrics.revenue : b.metrics.grossProfit
    if (av === undefined || bv === undefined) return av === bv ? compare(a.id, b.id) : av === undefined ? 1 : -1
    return av === bv ? compare(a.id, b.id) : av > bv ? -1 : 1
  })
}

/** Include actual expense dates outside the planned event without distributing them. */
export function financialDayStatistics(records: readonly AnalyticalSale[], expenses: readonly Expense[], event?: CatalogEvent, offset = 0) {
  const active = expenses.filter(expense => expense.status === 'active')
  const actual = [...records.map(record => record.day), ...active.map(expense => expense.date)].sort()
  const start = event?.startDate ?? actual[0], end = event?.endDate ?? actual.at(-1)
  const base = eventDayStatistics(records, start && end ? { startDate: start, endDate: end } : undefined, offset)
  const outside = [...new Set([...base.outside.map(row => row.day), ...active.filter(expense => !!start && !!end && (expense.date < start || expense.date > end)).map(expense => expense.date)])].sort()
  return { ...base, days: base.days.map(row => ({ ...row, financial: financialMetrics(row.metrics, active.filter(expense => expense.date === row.day)) })), outside: outside.map(day => {
    const metrics = summarizeSales(records.filter(record => record.day === day))
    return { day, metrics, financial: financialMetrics(metrics, active.filter(expense => expense.date === day)) }
  }) }
}
