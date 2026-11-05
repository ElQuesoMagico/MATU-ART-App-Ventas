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
import { lazy, Suspense, useState, useEffect } from 'react'
const CatalogSyncBootstrap = lazy(()=>import('./components/cloud/CatalogSyncBootstrap').then(m=>({default:m.CatalogSyncBootstrap})))
const AccountAccess = lazy(()=>import('./components/cloud/AccountAccess').then(m=>({default:m.AccountAccess})))
import { useCart } from './hooks/useCart'
import { useOfflineStatus } from './services/offlineStatus'
import './styles/themes.css'
import './App.css'
import './styles/tickets.css'
export default function App() {
  const { page, navigate } = useNavigation()
  const cart = useCart()
  const offlineStatus = useOfflineStatus()
  useEffect(() => {
    if (!offlineStatus.startsWith('Actualización lista')) return
    const apply = () => {
      if (cart.count || cart.paymentDraft || cart.generalDiscount || document.visibilityState !== 'visible') return
      if (document.querySelector('[role="dialog"], dialog, form') || document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return
      window.location.reload()
    }
    const timer = window.setInterval(apply, 3000)
    return () => clearInterval(timer)
  }, [offlineStatus, cart.count, cart.paymentDraft, cart.generalDiscount])
  const [analyticsEventId, setAnalyticsEventId] = useState<string>()
  const openAnalytics = (eventId?: string) => { setAnalyticsEventId(eventId); navigate('estadisticas') }
  return <div className="app-shell" data-theme="cherry" data-mode="light">
    {import.meta.env.VITE_FIREBASE_CATALOG_ENABLED==='true' && <Suspense fallback={null}><CatalogSyncBootstrap /></Suspense>}
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus() }}>Saltar al contenido</a>
    <Navigation page={page} navigate={navigate} />
    <div className="workspace">
      <header className="topbar"><span className="atelier"><img className="topbar-logo" src={artisticAssets.brandLogo} alt="" /> MATU ART</span><Suspense fallback={<span className="demo-tag">Datos locales</span>}><AccountAccess /></Suspense></header>
      <main id="main" tabIndex={-1} data-page={page}>
        {offlineStatus.startsWith('Actualización lista') && <p className="local-note" role="status">Nueva versión descargada. Se aplicará automáticamente al terminar la venta y cerrar los formularios.</p>}
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
