import { CreateEntityMenu } from '../components/catalog/CreateEntityMenu'
import { DeleteEntityDialog } from '../components/catalog/DeleteEntityDialog'
import { PromotionManager } from '../components/catalog/PromotionManager'
import { DataManager } from '../components/data/DataManager'
import type { ClassificationKind } from '../types/catalog'
import { QuickClassificationDialog } from '../components/catalog/QuickClassificationDialog'
import { lazy, Suspense, useState } from 'react'
import { useStorageAction } from '../hooks/useStorageAction'
import { catalogRepository } from '../services/catalogRepository'
import { useCatalog } from '../hooks/useCatalog'
import type { CatalogProduct } from '../types/catalog'
import { money } from '../utils/format'
import { classificationNames, matchesClassifications, productFamilyIds } from '../services/catalogClassification'
import { ClassificationSelect } from '../components/catalog/ClassificationSelect'
import { ProductImage } from '../components/ProductImage'
import { EmptyState, PageHeading, SearchField } from '../components/ui'
import { CatalogStatus } from '../components/CatalogStatus'
import { ProductForm } from '../components/catalog/ProductForm'
import { StockForm } from '../components/catalog/StockForm'
import { MovementHistory } from '../components/catalog/MovementHistory'

import { ClassificationManager } from '../components/catalog/ClassificationManager'
type InventoryDialog = { kind: 'new' | 'organization' | 'promotions' | 'all-history' } | { kind: 'edit' | 'stock' | 'history'; product: CatalogProduct }
const CloudConnection = lazy(()=>import('../components/cloud/CloudConnection').then(module=>({default:module.CloudConnection})))
const ImportManager = lazy(()=>import('../components/importing/ImportManager').then(module=>({default:module.ImportManager})))
export function Inventory() {
  const [deleting, setDeleting] = useState<CatalogProduct>()
  const [showCloud,setShowCloud]=useState(false)
  const [showImport,setShowImport]=useState(false)
  const [showData,setShowData]=useState(false)
  const catalog = useCatalog()
  const action = useStorageAction()
  const [quickStandalone,setQuickStandalone] = useState(false)
  const [quickKind,setQuickKind] = useState<ClassificationKind>()
  const [query, setQuery] = useState('')
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [familyIds, setFamilyIds] = useState<string[]>([])
  const [ipIds, setIpIds] = useState<string[]>([])
  const [status, setStatus] = useState('active')
  const [dialog, setDialog] = useState<InventoryDialog>()
  const [notice, setNotice] = useState('')
  const products = catalog.products.filter(product => (status === 'all' || product.isArchived === (status === 'archived')) && matchesClassifications(product, familyIds, ipIds, categoryIds) && `${product.name} ${classificationNames(productFamilyIds(product), catalog.families)} ${classificationNames(product.ipIds ?? [], catalog.ips)}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))
  const archivedCount = catalog.products.filter(product => product.isArchived).length
  const close = () => setDialog(undefined)
  return <>
    <PageHeading title="Inventario" action={<div className="heading-actions"><button className="button secondary" onClick={()=>setShowData(true)}>Datos y respaldos</button><button className="button secondary" disabled={catalog.loading || !!catalog.error} onClick={() => setDialog({ kind: 'all-history' })}>Movimientos</button><button className="button secondary" disabled={catalog.loading || !!catalog.error} onClick={() => setDialog({ kind: 'organization' })}>Organizar catálogo</button><CreateEntityMenu disabled={catalog.loading || !!catalog.error} onSelect={kind => { if (kind === 'products') setDialog({kind:'new'}); else if (kind === 'promotions') setDialog({kind:'promotions'}); else { setQuickStandalone(true); setQuickKind(kind) } }} /></div>} />
    <p className="local-note">Catálogo local · Guardado en este navegador. Sin respaldo en la nube. </p><CatalogStatus />
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}
    {notice && <p className="save-notice" role="status">{notice}</p>}
    <div className="toolbar"><SearchField value={query} onChange={setQuery} placeholder="Buscar por nombre o clasificación…" /><ClassificationSelect label="Categorías" onCreate={() => { setQuickStandalone(false); setQuickKind('categories') }} items={catalog.categories} selected={categoryIds} onChange={setCategoryIds} /><ClassificationSelect label="Familias" onCreate={() => { setQuickStandalone(false); setQuickKind('families') }} items={catalog.families} selected={familyIds} onChange={setFamilyIds} /><ClassificationSelect label="IPs" onCreate={() => { setQuickStandalone(false); setQuickKind('ips') }} items={catalog.ips} selected={ipIds} onChange={setIpIds} /><div className="product-status-filter" role="group" aria-label="Estado de productos">{[['active','Activos'],['archived',`Archivados (${archivedCount})`],['all','Todos']].map(([value,label]) => <button type="button" key={value} className={`filter-chip ${status === value ? 'selected' : ''}`} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}</div><button type="button" className="text-button" onClick={() => { setCategoryIds([]); setFamilyIds([]); setIpIds([]); setQuery(''); setStatus('active') }}>Limpiar filtros</button></div>
    {!catalog.loading && !catalog.error && <button type="button" className="text-button archive-counter" aria-pressed={status === 'archived'} onClick={() => setStatus('archived')}>Archivados · {archivedCount}</button>}
    {!catalog.loading && !catalog.error && (products.length ? <section className="panel inventory-panel editorial-panel real-inventory" aria-label="Inventario local"><div className="inventory-head"><span>Producto / clasificación</span><span>Precio / costo</span><span>Stock</span><span>Acciones</span></div>{products.map(product => <article className="inventory-row" key={product.id}>
      <div className="inventory-name"><ProductImage product={product} small /><div><strong>{product.name}{product.kind==='pack'&&<span className="badge neutral">Pack</span>}{product.isFavorite && <span className="favorite-label"> · Destacado</span>}</strong><small>Categoría: {classificationNames(product.categoryId ? [product.categoryId] : [], catalog.categories) || 'Pendiente'}</small>{!!product.familyIds?.length && <small>Familias: {classificationNames(product.familyIds, catalog.families)}</small>}{!!product.ipIds?.length && <small>IPs: {classificationNames(product.ipIds, catalog.ips)}</small>}{product.isArchived && <span className="badge neutral">Archivado</span>}</div></div>
      <div className="inventory-price"><strong>{money(product.price)}</strong><small>Promedio: {product.averageCost === undefined ? 'Desconocido' : money(product.averageCost)}{product.averageCostIsProvisional && ' (provisional)'}</small><small>Último costo: {product.lastKnownCost === undefined ? 'Desconocido' : money(product.lastKnownCost)}</small><small>Estimado: {product.estimatedUnitCost === undefined ? 'Desconocido' : money(product.estimatedUnitCost)}</small></div>
      <div className="inventory-stock"><span className={`badge ${product.stock <= product.lowStockThreshold ? 'amber' : 'neutral'}`}>{product.stockCountPending ? 'Pendiente de conteo' : `${product.stock} uds.`}{!product.stockCountPending && product.stock <= product.lowStockThreshold && ' · Stock bajo'}</span>{product.stock < 0 && <strong className="negative-stock">Stock negativo</strong>}</div>
      <div className="inventory-actions">{product.isArchived && <button className="button secondary" disabled={action.saving} onClick={() => { void action.run(() => catalogRepository.setArchived(product.id, false, product.revision), () => setNotice('Producto reactivado.')) }}>Reactivar</button>}<button className="text-button" onClick={() => setDialog({ kind: 'edit', product })}>Editar</button><button className="text-button" disabled={product.isArchived} onClick={() => setDialog({ kind: 'stock', product })}>Ajustar stock</button><button className="text-button" onClick={() => setDialog({ kind: 'history', product })}>Movimientos</button>{!product.isArchived && <button className="text-button" disabled={action.saving} onClick={() => { void action.run(() => catalogRepository.setArchived(product.id,true,product.revision), () => setNotice('Producto archivado.')) }}>Archivar</button>}<button className="text-button" onClick={() => setDeleting(product)}>Eliminar</button></div>
    </article>)}</section> : <><EmptyState title={catalog.products.length ? 'No hay coincidencias' : 'Tu catálogo está vacío'} description={catalog.products.length ? 'Prueba otros filtros o revisa los productos archivados.' : 'Crea tu primer producto para empezar a organizar el inventario.'} />{!catalog.products.length && <div className="empty-action"><button className="button primary" onClick={() => setDialog({ kind: 'new' })}>Crear primer producto</button></div>}</>)}
    <button className="button secondary" onClick={()=>setShowImport(true)}>Importación masiva · Administración</button>
    {showImport && <Suspense fallback={<p role="status">Abriendo importador…</p>}><ImportManager onClose={()=>setShowImport(false)} /></Suspense>}
    {showData && <DataManager onClose={()=>setShowData(false)} onCloud={()=>{setShowData(false);setShowCloud(true)}} />}
    {showCloud && <Suspense fallback={<p role="status">Abriendo conexión…</p>}><CloudConnection onClose={()=>setShowCloud(false)} /></Suspense>}
    {deleting && <DeleteEntityDialog kind="products" id={deleting.id} onClose={() => setDeleting(undefined)} onSaved={setNotice} onArchive={() => catalogRepository.setArchived(deleting.id,true,deleting.revision)} />}
    {dialog?.kind === 'promotions' && <PromotionManager onClose={close} onSaved={setNotice} />}
    {dialog?.kind === 'new' && <ProductForm onClose={close} onSaved={setNotice} />}
    {dialog?.kind === 'edit' && <ProductForm product={dialog.product} onClose={close} onSaved={setNotice} />}
    {dialog?.kind === 'stock' && <StockForm product={dialog.product} onClose={close} onSaved={setNotice} />}
    {dialog?.kind === 'history' && <MovementHistory product={dialog.product} onClose={close} />}
    {dialog?.kind === 'all-history' && <MovementHistory onClose={close} />}
    {dialog?.kind === 'organization' && <ClassificationManager onClose={close} onPromotions={() => { close(); window.location.hash = 'promociones' }} onProducts={close} />}
    {quickKind && <QuickClassificationDialog standalone={quickStandalone} kind={quickKind} onClose={() => setQuickKind(undefined)} onCreated={item => { const update = quickKind === 'categories' ? setCategoryIds : quickKind === 'families' ? setFamilyIds : setIpIds; if (!quickStandalone) update(current => [...new Set([...current,item.id])]); setNotice('Clasificación creada.'); setQuickKind(undefined) }} />}
  </>
}
