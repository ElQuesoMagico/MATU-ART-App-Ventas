import type { ExpenseSnapshot } from '../types/expenses'
import { expenseRepository } from '../services/expenseRepository'
import type { Promotion } from '../types/promotions'
import { promotionRepository } from '../services/promotionRepository'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CatalogContext } from './catalogContext'
import { classificationRepository } from '../services/classificationRepository'
import { catalogRepository } from '../services/catalogRepository'
import { salesRepository } from '../services/salesRepository'
import { storageError } from '../services/catalogValidation'
import type { CatalogSnapshot, ClassificationSnapshot } from '../types/catalog'
import type { StoredSale } from '../types/sales'
import type { CatalogEvent } from '../types/events'
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot & ClassificationSnapshot & ExpenseSnapshot & { promotions: Promotion[]; sales: StoredSale[]; realEvents: CatalogEvent[]; eventRevision: number }>({ products: [], categories: [], families: [], ips: [], promotions: [], sales: [], realEvents: [], eventRevision: 0, expenses: [], expenseCategories: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)
  const reload = useCallback(async () => {
    const current = ++request.current
    try { const [catalog, sales, classifications, promotions, expenses] = await Promise.all([catalogRepository.snapshot(), salesRepository.snapshot(), classificationRepository.snapshot(), promotionRepository.snapshot(), expenseRepository.snapshot()]); if (current === request.current) { setSnapshot({ ...catalog, ...sales, ...classifications, promotions, ...expenses }); setError('') } }
    catch (error) { if (current === request.current) setError(storageError(error)) }
    finally { if (current === request.current) setLoading(false) }
  }, [])
  useEffect(() => {
    queueMicrotask(() => { void reload() })
    const refresh = () => { void reload() }
    const blocked = () => setError('Otra pestaña impide actualizar la base local. Cierra las otras pestañas de MATU ART y vuelve a intentar.')
    window.addEventListener('focus', refresh)
    window.addEventListener('catalog-blocked', blocked)
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('clown-ufo-catalog') : undefined
    if (channel) channel.onmessage = refresh
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('catalog-blocked', blocked); channel?.close() }
  }, [reload])
  return <CatalogContext.Provider value={{ ...snapshot, loading, error, reload }}>{children}</CatalogContext.Provider>
}
