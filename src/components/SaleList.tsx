import type { Sale } from '../types'
import { demoRepository, saleTotal } from '../services/demoRepository'
import { dateLabel, money, timeLabel } from '../utils/format'
import { Icon } from './Icon'
import { EmptyState } from './ui'
export function SaleList({ sales, compact = false }: { sales: Sale[]; compact?: boolean }) {
  const products = demoRepository.getProducts()
  if (!sales.length) return <EmptyState title="Sin ventas" description="No hay ventas para este evento." />
  return <div className="sale-list">{sales.map(sale => <article className="sale-row" key={sale.id}>
    <span className="sale-icon"><Icon name="bag" /></span>
    <div className="sale-details"><strong>{sale.id}</strong><p>{sale.items.map(item => `${item.quantity} × ${products.find(product => product.id === item.productId)?.name ?? 'Producto'}`).join(' · ')}</p><small>{!compact && `${dateLabel(sale.date.slice(0, 10))} · `}{timeLabel(sale.date)} · {sale.payment}</small></div>
    <strong className="sale-total">{money(saleTotal(sale))}</strong>
  </article>)}</div>
}
