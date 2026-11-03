import { artisticAssets } from './assets/artisticAssets'
import { Navigation } from './navigation/Navigation'
import { useNavigation } from './navigation/useNavigation'
import { Home } from './screens/Home'
import { PointOfSale } from './screens/PointOfSale'
import { Inventory } from './screens/Inventory'
import { History } from './screens/History'
import { Promotions } from './screens/Promotions'
import { Events } from './screens/Events'
import { Analytics } from './screens/Analytics'
import { lazy, Suspense, useState } from 'react'
const CatalogSyncBootstrap = lazy(()=>import('./components/cloud/CatalogSyncBootstrap').then(m=>({default:m.CatalogSyncBootstrap})))
import { useCart } from './hooks/useCart'
import { useOfflineStatus } from './services/offlineStatus'
import './styles/themes.css'
import './App.css'
import './styles/tickets.css'
export default function App() {
  const { page, navigate } = useNavigation()
  const cart = useCart()
  const offlineStatus = useOfflineStatus()
  const [analyticsEventId, setAnalyticsEventId] = useState<string>()
  const openAnalytics = (eventId?: string) => { setAnalyticsEventId(eventId); navigate('estadisticas') }
  return <div className="app-shell" data-theme="cherry" data-mode="light">
    {import.meta.env.VITE_FIREBASE_CATALOG_ENABLED==='true' && <Suspense fallback={null}><CatalogSyncBootstrap /></Suspense>}
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus() }}>Saltar al contenido</a>
    <Navigation page={page} navigate={navigate} />
    <div className="workspace">
      <header className="topbar"><span className="atelier"><img className="topbar-logo" src={artisticAssets.brandLogo} alt="" /> MATU ART</span><span className="demo-tag" title="Catálogo, ventas y eventos guardados en este navegador."><span className="status-dot" />Datos locales</span></header>
      <main id="main" tabIndex={-1} data-page={page}>
        {offlineStatus.startsWith('Actualización descargada') && <p className="local-note" role="status">Hay una nueva versión. Termina las ventas y guarda los formularios abiertos antes de <a href={`${import.meta.env.BASE_URL}actualizar.html`}>actualizar MATU ART</a>.</p>}
        {page === 'inicio' && <Home navigate={navigate} openAnalytics={openAnalytics} />}
        {page === 'estadisticas' && <Analytics navigate={navigate} initialEventId={analyticsEventId} />}
        {page === 'venta' && <PointOfSale cart={cart} />}
        {page === 'inventario' && <Inventory />}
        {page === 'historial' && <History />}
        {page === 'promociones' && <Promotions />}
        {page === 'eventos' && <Events />}
      </main>
      <footer className="footer"><p className="demo-notice">Datos guardados en este navegador, sin respaldo en la nube.</p><span>MATU ART</span></footer>
    </div>
  </div>
}
