import { TicketFrame } from '../components/TicketFrame'
import { useState } from 'react'
import type { Promotion } from '../types/promotions'
import { useCatalog } from '../hooks/useCatalog'
import { useStorageAction } from '../hooks/useStorageAction'
import { PageHeading, EmptyState, SearchField } from '../components/ui'
import { CatalogStatus } from '../components/CatalogStatus'
import { PromotionManager } from '../components/catalog/PromotionManager'
import { Modal } from '../components/Modal'
import { Ornament } from '../components/Ornament'
import { promotionRepository } from '../services/promotionRepository'
import { promotionAudience, promotionEvents, promotionStatus } from '../services/promotionPresentation'
import { discountLabel } from '../utils/discounts'
import { money } from '../utils/format'
export function Promotions() {
  const catalog = useCatalog()
  const action = useStorageAction()
  const [form, setForm] = useState<{ promotion?: Promotion }>()
  const [detail, setDetail] = useState<Promotion>()
  const [archive, setArchive] = useState<Promotion>()
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const labels = { products:catalog.products, categories:catalog.categories, families:catalog.families, ips:catalog.ips, events:catalog.realEvents }
  const items = catalog.promotions.filter(p => `${p.name} ${p.description ?? ''}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')) && (status === 'all' || (status === 'archived' ? p.isArchived : !p.isArchived && p.isActive === (status === 'active'))))
  const blocked = catalog.loading || !!catalog.error || action.saving
  function change(item: Promotion, flags: Partial<Promotion>) { void action.run(() => promotionRepository.save({...item,...flags},item.updatedAt), () => { setNotice('Promoción actualizada.'); setArchive(undefined) }) }
  return <><PageHeading title="Promociones" action={<button className="button primary" disabled={blocked} onClick={() => setForm({})}>Nueva promoción</button>} /><CatalogStatus />
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}{notice && <p className="save-notice" role="status">{notice}</p>}
    <div className="toolbar"><SearchField value={query} onChange={setQuery} placeholder="Buscar promociones…" /><label className="select-field">Estado<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todas</option><option value="active">Activas</option><option value="inactive">Inactivas</option><option value="archived">Archivadas</option></select></label></div>
    <section className="promotion-cards" aria-label="Promociones del catálogo">{items.map(p => <article className="panel promotion-card ticket-shaped" key={p.id}><TicketFrame /><header><Ornament kind="starburst" size={20} /><h2>{p.name}</h2><span className={`badge ${p.isActive && !p.isArchived ? 'pink' : 'neutral'}`}>{promotionStatus(p)}</span></header><p className="promotion-benefit">{p.type === 'quantity' ? `${p.groupQuantity} unidades por ${money(p.value)}` : p.type === 'combo' ? `Combo por ${money(p.value)}` : p.type === 'percentage' ? `${p.value} % de descuento` : `${money(p.value)} de descuento`}</p><div className="promotion-targets">{promotionAudience(p,labels).length ? promotionAudience(p,labels).map(row => <p key={row}>{row}</p>) : <p>Todos los productos</p>}{!!p.eventIds?.length && <p>Eventos: {promotionEvents(p,catalog.realEvents)}</p>}</div><footer><button className="text-button" disabled={blocked} onClick={() => setDetail(p)}>Ver detalle</button><button className="button secondary" disabled={blocked} onClick={() => setForm({promotion:p})}>Editar</button>{!p.isArchived && <button className="text-button" disabled={blocked} onClick={() => change(p,{isActive:!p.isActive})}>{p.isActive ? 'Desactivar' : 'Activar'}</button>}<button className="text-button" disabled={blocked} onClick={() => p.isArchived ? change(p,{isArchived:false,isActive:false}) : setArchive(p)}>{p.isArchived ? 'Reactivar' : 'Archivar'}</button></footer></article>)}</section>
    {!catalog.loading && !catalog.error && !items.length && <EmptyState title="No hay promociones" description={catalog.promotions.length ? 'Prueba otra búsqueda o estado.' : 'Crea una promoción cuando la necesites.'} />}
    <p className="local-note">Los precios por evento existentes se conservan en Editar producto.</p>
    {form && <PromotionManager promotion={form.promotion} onSaved={setNotice} onClose={() => setForm(undefined)} />}
    {detail && <Modal title={detail.name} onClose={() => setDetail(undefined)}><div className="promotion-detail"><span className="badge neutral">{promotionStatus(detail)}</span><h3>{detail.type === 'quantity' ? `${detail.groupQuantity} unidades por ${money(detail.value)}` : discountLabel(detail)}</h3>{detail.description && <p>{detail.description}</p>}{promotionAudience(detail,labels).map(row => <p key={row}>{row}</p>)}{!promotionAudience(detail,labels).length && <p>Todos los productos</p>}<p>Eventos: {promotionEvents(detail,catalog.realEvents) || 'Sin restricción'}</p><p>{detail.isStackable ? 'Acumulable según compatibilidad' : 'No acumulable sobre las mismas unidades'}</p><p>Vigencia: {detail.startDate || 'Sin inicio'} · {detail.endDate || 'Sin término'}</p>{detail.type !== 'combo' && <p>Mínimos: {detail.minimumQuantity} unidades · {money(detail.minimumAmount)}</p>}<div className="form-actions"><button className="button secondary" data-close-modal>Cerrar</button><button className="button primary" onClick={() => { setForm({promotion:detail}); setDetail(undefined) }}>Editar promoción</button></div></div></Modal>}
    {archive && <Modal title="Archivar promoción" onClose={() => setArchive(undefined)} busy={action.saving}><p>¿Archivar «{archive.name}»? Dejará de aplicarse a nuevas ventas. Las ventas anteriores conservarán su beneficio.</p>{action.error && <p className="storage-error" role="alert">{action.error}</p>}<div className="form-actions"><button className="button secondary" data-close-modal disabled={action.saving}>Cancelar</button><button className="button primary" disabled={action.saving} onClick={() => change(archive,{isArchived:true,isActive:false})}>{action.saving ? 'Guardando…' : 'Confirmar archivo'}</button></div></Modal>}
  </>
}
