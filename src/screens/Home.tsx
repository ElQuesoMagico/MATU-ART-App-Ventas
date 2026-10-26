import type { Page } from '../types'
import { currentDateLabel } from '../utils/format'
import { eventDateRange } from '../services/eventRules'
import { Icon } from '../components/Icon'
import { EmptyState, PageHeading } from '../components/ui'
import { ProductImage } from '../components/ProductImage'
import { useCatalog } from '../hooks/useCatalog'
import { CatalogStatus } from '../components/CatalogStatus'
import { classificationNames, productFamilyIds } from '../services/catalogClassification'
import { StoredSaleList } from '../components/StoredSaleList'
import { SaleDetail } from '../components/SaleDetail'
import { useState } from 'react'
import type { StoredSale } from '../types/sales'
import { CircusIllustration } from '../components/CircusIllustration'
import { useAnalytics } from '../hooks/useAnalytics'
import { EventStatisticsCard, MetricTickets } from '../components/analytics/Statistics'
import '../styles/analytics.css'

export function Home({ navigate, openAnalytics }: { navigate: (page: Page) => void; openAnalytics: (eventId?: string) => void }) {
  const catalog = useCatalog()
  const { data, error } = useAnalytics()
  const activeEvent = catalog.realEvents.find(event => event.status === 'active')
  const activeStatistics = data?.events.find(event => event.id === activeEvent?.id)
  const [detail, setDetail] = useState<StoredSale>()
  const lowStock = catalog.products.filter(product => !product.isArchived && !product.stockCountPending && product.stock <= product.lowStockThreshold)
  return <>
    <PageHeading title="Inicio" action={<p className="home-date">{currentDateLabel()}</p>} />
    <section className="event-poster home-pos-poster" aria-label="Acceso al punto de venta">
      <div className="event-poster-copy"><span className="eyebrow">MATU ART</span><h2>Bienvenida a tu feria</h2><button className="button primary" onClick={() => navigate('venta')}>Ir al punto de venta <Icon name="arrow" size={18} /></button></div>
      <CircusIllustration className="event-poster-art" />
    </section>
    <section className="panel home-active-event" aria-label="Evento activo"><div><span className="badge neutral">{activeEvent ? 'Evento activo' : 'Sin evento activo'}</span>{catalog.loading || catalog.error ? <CatalogStatus /> : activeEvent ? <><h2>{activeEvent.name}</h2><p>{activeEvent.location}{activeEvent.location && ' · '}{eventDateRange(activeEvent)}</p></> : <h2>Sin evento activo</h2>}</div><button className="button secondary" onClick={() => navigate('eventos')}>Ver eventos <Icon name="arrow" size={16} /></button></section>
    <div className="section-heading summary-heading"><h2>{activeEvent ? 'Resultados del evento' : 'Últimos eventos'}</h2><button className="text-button" onClick={() => openAnalytics()}>Ver estadísticas <Icon name="arrow" size={16} /></button></div>
    {error && <p role="alert" className="storage-error">{error}</p>}
    {!catalog.loading && !catalog.error && data && (activeStatistics ? <section aria-label="Resultados del evento activo"><MetricTickets metrics={activeStatistics.metrics} /><button className="button secondary home-statistics-link" onClick={() => openAnalytics(activeStatistics.id)}>Estadísticas de {activeStatistics.name}</button></section> : <div className="analytics-events home-event-results">{data.events.filter(event => event.metrics.transactions > 0).slice(0, 3).map(event => <EventStatisticsCard key={event.id} stats={event} onOpen={openAnalytics} />)}{!data.events.some(event => event.metrics.transactions > 0) && <EmptyState title="Sin eventos con ventas" description="Puedes registrar ventas sin evento o crear uno desde Eventos." />}</div>)}
    <div className="home-records">
      <section className="panel replenish-panel home-stock-panel"><div className="section-heading"><h2>Stock bajo{!catalog.loading && !catalog.error && ` · ${lowStock.length}`}</h2><button className="text-button" onClick={() => navigate('inventario')}>Ver inventario <Icon name="arrow" size={16} /></button></div>
        {catalog.loading || catalog.error ? <CatalogStatus /> : lowStock.length ? <div className="stock-list">{lowStock.map(product => <div className="stock-row" key={product.id}><ProductImage product={product} small /><div><strong>{product.name}</strong><small>{classificationNames(productFamilyIds(product), catalog.families) || 'Sin familia'}</small></div><span className="badge amber">{product.stock} uds.</span></div>)}</div> : <EmptyState title="Sin alertas de stock confirmado" description="Los productos pendientes de conteo se revisan en Inventario." />}
      </section>
      <section className="panel recent-sales"><div className="section-heading"><h2>Últimas ventas</h2><button className="text-button" onClick={() => navigate('historial')}>Ver historial <Icon name="arrow" size={16} /></button></div><StoredSaleList sales={catalog.sales.slice(0, 3)} onOpen={setDetail} /></section>
    </div>
    {detail && <SaleDetail sale={detail} onClose={() => setDetail(undefined)} />}
  </>
}
