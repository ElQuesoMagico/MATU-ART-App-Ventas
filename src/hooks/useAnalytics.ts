import { useMemo } from 'react'
import { useCatalog } from './useCatalog'
import { buildAnalytics } from '../services/analytics'

export function useAnalytics() {
  const { sales, realEvents, expenses } = useCatalog()
  return useMemo(() => {
    try { return { data: buildAnalytics(sales, realEvents, expenses), error: '' } }
    catch { return { data: undefined, error: 'No se pudieron interpretar los importes históricos. Revisa las ventas antes de utilizar estas estadísticas.' } }
  }, [sales, realEvents, expenses])
}
