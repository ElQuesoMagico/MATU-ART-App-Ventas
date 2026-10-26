import { artisticAssets } from '../assets/artisticAssets'
import type { Page } from '../types'
import { Icon, type IconName } from '../components/Icon'
import { Ornament } from '../components/Ornament'
import { useCatalog } from '../hooks/useCatalog'
import { eventDateRange } from '../services/eventRules'
const links: { page: Page; label: string; short: string; icon: IconName }[] = [
  { page: 'inicio', label: 'Inicio', short: 'Inicio', icon: 'home' }, { page: 'venta', label: 'Punto de venta', short: 'Venta', icon: 'bag' },
  { page: 'inventario', label: 'Inventario', short: 'Inventario', icon: 'box' }, { page: 'historial', label: 'Historial', short: 'Historial', icon: 'clock' }, { page: 'promociones', label: 'Promociones', short: 'Promos', icon: 'sparkle' }, { page: 'eventos', label: 'Eventos', short: 'Eventos', icon: 'tent' },
]
export function Navigation({ page, navigate }: { page: Page; navigate: (page: Page) => void }) {
  const catalog = useCatalog()
  const activeEvent = catalog.realEvents.find(event => event.status === 'active')
  return <aside className="sidebar">
    <a className="brand" href="#inicio" aria-label="MATU ART, inicio"><img className="official-logo" src={artisticAssets.brandLogo} alt="MATU ART" /></a>
    <div className="program-heading"><Ornament kind="divider" /></div>
    <nav aria-label="Navegación principal">{links.map((link, index) => <button key={link.page} className={`nav-link ${page === link.page ? 'is-active' : ''}`} aria-current={page === link.page ? 'page' : undefined} onClick={() => navigate(link.page)}><Icon name={link.icon} /><span className="nav-full">{link.label}</span><span className="nav-short">{link.short}</span><span className="nav-number" aria-hidden="true">0{index + 1}</span></button>)}</nav>
    <div className="sidebar-note"><Ornament kind="bunting" className="note-bunting" /><span className="sidebar-event-label">Evento activo</span><h3>{catalog.loading ? 'Cargando…' : catalog.error ? 'No disponible' : activeEvent?.name ?? 'Sin evento activo'}</h3>{activeEvent && !catalog.error && <p>{eventDateRange(activeEvent)}</p>}<button className="text-button" onClick={() => navigate('eventos')}>Ver eventos <Icon name="arrow" size={14} /></button></div>
    <div className="sidebar-bottom"><span className="avatar"><Ornament kind="rosette" size={30} /></span><strong>MATU ART</strong></div>
  </aside>
}

