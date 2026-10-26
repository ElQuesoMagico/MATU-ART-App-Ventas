import type { StoredSale } from '../types/sales'
import { money, dateTimeLabel } from '../utils/format'
import { paymentLabels, saleNumber } from '../utils/sales'
import { Icon } from './Icon'
import { EmptyState } from './ui'
export function StoredSaleList({ sales, onOpen }: { sales: StoredSale[]; onOpen: (sale: StoredSale) => void }) {
  if (!sales.length) return <EmptyState title="Sin ventas" description="Las ventas registradas aparecerán aquí." />
  return <div className="sale-list">{sales.map(sale => <article className="sale-row" key={sale.id}><span className="sale-icon"><Icon name="bag" /></span><div className="sale-details"><button className="text-button" onClick={() => onOpen(sale)}>{saleNumber(sale.number)}</button><p>{sale.items.map(item => `${item.quantity} × ${item.name}`).join(' · ')}</p><small>{dateTimeLabel(sale.soldAt)} · {sale.payments.map(payment => paymentLabels[payment.method]).join(' + ')}</small>{sale.discount > 0 && <p className="discount-note">Descuentos: −{money(sale.discount)}</p>}<p className="sale-event"><span>{sale.event?.name ?? 'Sin evento'}</span> <span className={`badge ${sale.status === 'completed' ? 'green' : 'neutral'}`}>{sale.status === 'completed' ? 'Registrada' : 'Anulada'}</span></p></div><strong className="sale-total">{money(sale.total)}</strong></article>)}</div>
}
