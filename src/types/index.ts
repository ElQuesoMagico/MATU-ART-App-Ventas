import type { ManualDiscount } from './discounts'
export type Page = 'inicio' | 'venta' | 'inventario' | 'historial' | 'eventos' | 'promociones' | 'estadisticas'
export type Category = 'Stickers' | 'Prints' | 'Llaveros' | 'Libretas'
export interface Product { id: string; name: string; category: Category; price: number; stock: number; lowStockThreshold: number; art: 'moon' | 'flower' | 'cat' | 'planet' | 'sun' | 'ghost'; color: string }
export interface FairEvent { id: string; name: string; date: string; location: string; status: 'active' | 'upcoming' | 'finished' }
export interface SaleItem { productId: string; quantity: number; unitPrice: number }
export interface Sale { id: string; eventId: string; date: string; payment: 'Efectivo' | 'MACH' | 'Transferencia'; items: SaleItem[] }
export interface CartItem { productId: string; quantity: number; discount?: ManualDiscount }
