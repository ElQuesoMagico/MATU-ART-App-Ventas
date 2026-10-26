import type { ExpenseSnapshot } from '../types/expenses'
import type { Promotion } from '../types/promotions'
import { createContext } from 'react'
import type { CatalogSnapshot, ClassificationSnapshot } from '../types/catalog'
import type { StoredSale } from '../types/sales'
import type { CatalogEvent } from '../types/events'
export interface CatalogState extends CatalogSnapshot, ClassificationSnapshot, ExpenseSnapshot { promotions: Promotion[]; sales: StoredSale[]; realEvents: CatalogEvent[]; eventRevision: number; loading: boolean; error: string; reload: () => Promise<void> }
export const CatalogContext = createContext<CatalogState | null>(null)
