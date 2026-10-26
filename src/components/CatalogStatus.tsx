import { useCatalog } from '../hooks/useCatalog'
export function CatalogStatus() {
  const { loading, error, reload } = useCatalog()
  if (error) return <div className="storage-error" role="alert"><p>{error}</p><button className="button" onClick={() => { void reload() }}>Reintentar</button></div>
  if (loading) return <p className="muted" role="status">Abriendo catálogo local…</p>
  return null
}
