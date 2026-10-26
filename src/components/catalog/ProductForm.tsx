import { useId, useState, type FormEvent } from 'react'
import type { CatalogProduct, ProductFields, ClassificationKind } from '../../types/catalog'
import { useCatalog } from '../../hooks/useCatalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { catalogRepository } from '../../services/catalogRepository'
import { initialProductCosts, productFormErrors } from '../../services/productFormRules'
import { money } from '../../utils/format'
import { ClassificationSelect } from './ClassificationSelect'
import { QuickClassification } from './QuickClassification'
import { Modal } from '../Modal'
import { ProductImage } from '../ProductImage'
import { EventPricesEditor, type EventPriceDraft } from './EventPricesEditor'
export function ProductForm({ product, onClose, onSaved }: { product?: CatalogProduct; onClose: () => void; onSaved: (message: string) => void }) {
  const { categories, families, ips, products, realEvents } = useCatalog()
  const [quickKind, setQuickKind] = useState<ClassificationKind>()
  const [quickBusy, setQuickBusy] = useState(false)
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '')
  const action = useStorageAction()
  const [id] = useState(() => product?.id ?? crypto.randomUUID())
  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [familyIds, setFamilyIds] = useState(product?.familyIds ?? [])
  const [ipIds, setIpIds] = useState(product?.ipIds ?? [])
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [eventPrices, setEventPrices] = useState<EventPriceDraft[]>(() => (product?.eventPrices ?? []).map(item => ({ key: crypto.randomUUID(), eventId: item.eventId, price: String(item.price) })))
  const [stock, setStock] = useState('0')
  const [cost, setCost] = useState(product?.estimatedUnitCost === undefined ? '' : String(product.estimatedUnitCost))
  const [costReason, setCostReason] = useState('')
  const [threshold, setThreshold] = useState(String(product?.lowStockThreshold ?? 5))
  const [image, setImage] = useState(product?.image)
  const [packContents, setPackContents] = useState(product?.packContents ?? [])
  const [favorite, setFavorite] = useState(product?.isFavorite ?? false)
  const [errors, setErrors] = useState<ReturnType<typeof productFormErrors>>({})
  const errorId = useId()
  const snapshot = JSON.stringify({ name, description, categoryId, familyIds, ipIds, price, stock, cost, costReason, threshold, favorite, packContents, eventPrices: eventPrices.map(p => [p.eventId,p.price]) })
  const [initial] = useState(snapshot)
  const dirty = snapshot !== initial || image !== product?.image
  const error = (field: keyof typeof errors) => errors[field] && <small className="field-error" id={`${errorId}-${field}`} role="alert">{errors[field]}</small>
  const props = (field: keyof typeof errors) => ({ 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? `${errorId}-${field}` : undefined })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = productFormErrors({ name, categoryId, price, cost, stock, threshold }, products, product)
    if (image && (!(image instanceof Blob) || !['image/png','image/jpeg','image/webp'].includes(image.type) || image.size > 5 * 1024 * 1024)) next.image = 'Usa PNG, JPEG o WebP de hasta 5 MB.'
    setErrors(next)
    if (Object.keys(next).length) return
    if (eventPrices.some(item => !/^\d+$/.test(item.price.trim()) || Number(item.price) > 1_000_000_000)) { action.setError('Revisa los precios por evento: usa enteros entre 0 y 1.000.000.000.'); return }
    const fields: ProductFields = { kind: product?.kind ?? 'product', packContents: product?.kind === 'pack' ? packContents : undefined, name, description, categoryIds: product?.categoryIds ?? [], categoryId, familyIds, ipIds, price: Number(price), lowStockThreshold: Number(threshold), image, isFavorite: favorite, estimatedUnitCost: initialProductCosts(cost).estimatedUnitCost }
    if (product) fields.eventPrices = eventPrices.map(item => ({ eventId: item.eventId, price: Number(item.price) }))
    void action.run(() => product ? catalogRepository.updateProduct(id, fields, product.revision, costReason) : catalogRepository.createProduct({ ...fields, id, initialStock: Number(stock), ...initialProductCosts(cost) }), () => { onSaved(product ? 'Producto actualizado.' : 'Producto creado.'); onClose() })
  }
  return <Modal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} busy={action.saving || quickBusy} protectChanges hasChanges={dirty}>
    <form className="catalog-form product-form" noValidate onSubmit={submit}>
      {action.error && <p className="storage-error" role="alert">{action.error}</p>}
      <fieldset disabled={action.saving} className="form-fields">
        <label>Nombre<input autoFocus maxLength={120} value={name} onChange={event => { setName(event.target.value); setErrors(current => ({ ...current, name: undefined })) } } {...props('name')} />{error('name')}</label>
        <div className="product-category-row"><div><ClassificationSelect label="Categoría principal" items={categories} selected={categoryId ? [categoryId] : []} onChange={ids => { setCategoryId(ids[0] ?? ''); setErrors(current => ({ ...current, categoryId: undefined })) }} single assign emptyLabel="Seleccionar" invalid={!!errors.categoryId} describedBy={errors.categoryId ? `${errorId}-categoryId` : undefined} onCreate={() => setQuickKind('categories')} />{error('categoryId')}</div></div>
        <div className="form-grid"><label>Precio general (CLP)<input inputMode="numeric" value={price} onChange={event => { setPrice(event.target.value); setErrors(current => ({ ...current, price: undefined })) } } {...props('price')} />{error('price')}</label><label>{product ? 'Costo estimado unitario (CLP)' : 'Costo unitario (CLP)'}<input inputMode="numeric" value={cost} placeholder="Desconocido" onChange={event => { setCost(event.target.value); setErrors(current => ({ ...current, cost: undefined })) } } {...props('cost')} />{error('cost')}</label></div>
        {product && <EventPricesEditor events={realEvents} rows={eventPrices} onChange={setEventPrices} generalPrice={price} />}
        {product && (cost === '' ? undefined : Number(cost)) !== product.estimatedUnitCost && <label>Motivo del cambio de costo (opcional)<textarea rows={2} maxLength={500} value={costReason} onChange={event => setCostReason(event.target.value)} /></label>}
        <div className="form-grid">{!product ? <label>Stock inicial<input inputMode="numeric" value={stock} onChange={event => { setStock(event.target.value); setErrors(current => ({ ...current, stock: undefined })) } } {...props('stock')} />{error('stock')}</label> : <div className="product-stock-summary">Stock actual<strong>{product.stock}</strong><small>Usa «Ajustar stock» para modificarlo.</small></div>}<label>Umbral de stock bajo<input inputMode="numeric" value={threshold} onChange={event => { setThreshold(event.target.value); setErrors(current => ({ ...current, threshold: undefined })) } } {...props('threshold')} />{error('threshold')}</label></div>
        {!product && Number(stock) < 0 && <p className="stock-warning">El producto tendrá stock negativo.</p>}
        <div className="classification-fields product-associations"><ClassificationSelect label="Familias" items={families} selected={familyIds} onChange={setFamilyIds} assign onCreate={() => setQuickKind('families')} /><ClassificationSelect label="IPs" items={ips} selected={ipIds} onChange={setIpIds} assign onCreate={() => setQuickKind('ips')} /></div>
        <details className="product-details"><summary>Detalles adicionales</summary><div className="form-fields">
          <label>Descripción<textarea rows={2} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label>Imagen<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setImage(event.target.files?.[0] ?? image)} {...props('image')} />{error('image')}<small>PNG, JPEG o WebP. Máximo 5 MB.</small></label>
          {image && <div className="image-preview"><ProductImage product={{ ...(product ?? { id, name, categoryIds: [], familyIds, ipIds, price: Number(price), stock: Number(stock), lowStockThreshold: Number(threshold), isFavorite: favorite, isArchived: false, revision: 1, createdAt: '', updatedAt: '', averageCostIsProvisional: false }), image }} small /><button type="button" className="text-button" onClick={() => setImage(undefined)}>Quitar imagen</button></div>}
          <label className="check-label"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} />Destacado</label>
          {product && <div className="cost-summary"><p>Costo promedio: {product.averageCost === undefined ? 'Desconocido' : money(product.averageCost)}{product.averageCostIsProvisional && ' · Provisional'}</p><p>Último costo conocido: {product.lastKnownCost === undefined ? 'Desconocido' : money(product.lastKnownCost)}</p></div>}
          {product?.kind === 'pack' && <div className="pack-contents"><strong>Pack físico · stock propio</strong>{packContents.map((content,index) => <div className="form-grid" key={index}><label>Producto contenido<select value={content.productId} onChange={e => setPackContents(current => current.map((c,i) => i === index ? {...c,productId:e.target.value} : c))}><option value="">Seleccionar producto</option>{products.filter(p => p.id !== id && (!p.isArchived || p.id === content.productId)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Cantidad en el pack<input type="number" min="1" step="1" value={content.quantity} onChange={e => setPackContents(current => current.map((c,i) => i === index ? {...c,quantity:Number(e.target.value)} : c))} /></label><button type="button" className="text-button" onClick={() => setPackContents(current => current.filter((_,i) => i !== index))}>Quitar contenido</button></div>)}<button type="button" className="button secondary" onClick={() => setPackContents(current => [...current,{productId:'',quantity:1}])}>Agregar contenido documentado</button></div>}
        </div></details>
      </fieldset>
      <div className="form-actions">{product && <button className="text-button" type="button" disabled={action.saving} onClick={() => { void action.run(() => catalogRepository.setArchived(id, !product.isArchived, product.revision), () => { onSaved(product.isArchived ? 'Producto reactivado.' : 'Producto archivado.'); onClose() }) }}>{product.isArchived ? 'Reactivar' : 'Archivar'}</button>}<button className="button secondary" type="button" disabled={action.saving} data-close-modal>Cancelar</button><button className="button primary" type="submit" disabled={action.saving}>{action.saving ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
    {quickKind && <Modal title="Crear clasificación" onClose={() => setQuickKind(undefined)} busy={quickBusy} protectChanges><QuickClassification kind={quickKind} onBusy={setQuickBusy} onCancel={() => setQuickKind(undefined)} onCreated={item => { if (quickKind === 'categories') setCategoryId(item.id); else if (quickKind === 'families') setFamilyIds(current => [...new Set([...current,item.id])]); else setIpIds(current => [...new Set([...current,item.id])]); setQuickKind(undefined) }} /></Modal>}
  </Modal>
}
