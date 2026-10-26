import { useContext } from 'react'
import { CatalogContext } from './catalogContext'
export function useCatalog() {
  const context = useContext(CatalogContext)
  if (!context) throw new Error('Falta CatalogProvider.')
  return context
}
