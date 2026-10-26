import { demoDay, events, products, sales } from '../data/demo'
import type { FairEvent, Product, Sale } from '../types'
// Contrato de lectura para un futuro adaptador IndexedDB. No hay escrituras.
export interface DataRepository { getProducts(): Product[]; getEvents(): FairEvent[]; getSales(): Sale[] }
export const demoRepository: DataRepository = {
  getProducts: () => products.map(product => ({ ...product })),
  getEvents: () => events.map(event => ({ ...event })),
  getSales: () => sales.map(sale => ({ ...sale, items: sale.items.map(item => ({ ...item })) })),
}
export const saleTotal = (sale: Sale) => sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
export function getDemoSummary() {
  const todaySales = demoRepository.getSales().filter(sale => sale.date.startsWith(demoDay))
  return {
    revenue: todaySales.reduce((sum, sale) => sum + saleTotal(sale), 0),
    transactions: todaySales.length,
    units: todaySales.reduce((sum, sale) => sum + sale.items.reduce((count, item) => count + item.quantity, 0), 0),
    lowStock: demoRepository.getProducts().filter(product => product.stock <= product.lowStockThreshold),
    activeEvent: demoRepository.getEvents().find(event => event.status === 'active'),
    recentSales: todaySales.slice(0, 3),
  }
}
