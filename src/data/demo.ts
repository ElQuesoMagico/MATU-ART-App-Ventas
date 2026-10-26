import type { FairEvent, Product, Sale } from '../types'
// Fixtures de ejemplo. No representan operaciones ni inventario reales.
export const demoDay = '2026-10-12'
export const products: Product[] = [
  { id: 'prd-luna', name: 'Luna de bolsillo', category: 'Stickers', price: 1500, stock: 24, lowStockThreshold: 5, art: 'moon', color: 'lavender' },
  { id: 'prd-jardin', name: 'Jardín cósmico', category: 'Prints', price: 6000, stock: 12, lowStockThreshold: 5, art: 'flower', color: 'peach' },
  { id: 'prd-gato', name: 'Gatito astronauta', category: 'Llaveros', price: 4500, stock: 3, lowStockThreshold: 5, art: 'cat', color: 'mint' },
  { id: 'prd-orbita', name: 'Ideas en órbita', category: 'Libretas', price: 8000, stock: 8, lowStockThreshold: 5, art: 'planet', color: 'butter' },
  { id: 'prd-sol', name: 'Un rayito de sol', category: 'Stickers', price: 1500, stock: 4, lowStockThreshold: 5, art: 'sun', color: 'butter' },
  { id: 'prd-fantasma', name: 'Fantasma de feria', category: 'Prints', price: 6000, stock: 2, lowStockThreshold: 5, art: 'ghost', color: 'lavender' },
]
export const events: FairEvent[] = [
  { id: 'evt-odisea', name: 'Odisea Ilustrada', date: '2026-10-12', location: 'Santiago · Centro de creación', status: 'active' },
  { id: 'evt-pumpkin', name: 'Pumpkin Fest', date: '2026-10-31', location: 'Providencia · Feria de ilustración', status: 'upcoming' },
  { id: 'evt-primavera', name: 'Bazar de Primavera', date: '2026-09-26', location: 'Ñuñoa · Plaza del arte', status: 'finished' },
]
export const sales: Sale[] = [
  { id: 'DEMO-004', eventId: 'evt-odisea', date: '2026-10-12T15:42:00-03:00', payment: 'Transferencia', items: [{ productId: 'prd-orbita', quantity: 1, unitPrice: 8000 }, { productId: 'prd-luna', quantity: 2, unitPrice: 1500 }] },
  { id: 'DEMO-003', eventId: 'evt-odisea', date: '2026-10-12T14:18:00-03:00', payment: 'Efectivo', items: [{ productId: 'prd-jardin', quantity: 2, unitPrice: 6000 }] },
  { id: 'DEMO-002', eventId: 'evt-odisea', date: '2026-10-12T12:35:00-03:00', payment: 'MACH', items: [{ productId: 'prd-gato', quantity: 1, unitPrice: 4500 }, { productId: 'prd-sol', quantity: 3, unitPrice: 1500 }] },
  { id: 'DEMO-001', eventId: 'evt-odisea', date: '2026-10-12T11:06:00-03:00', payment: 'Efectivo', items: [{ productId: 'prd-fantasma', quantity: 1, unitPrice: 6000 }, { productId: 'prd-luna', quantity: 2, unitPrice: 1500 }] },
  { id: 'DEMO-000', eventId: 'evt-primavera', date: '2026-09-26T16:00:00-03:00', payment: 'Efectivo', items: [{ productId: 'prd-orbita', quantity: 2, unitPrice: 8000 }] },
]
