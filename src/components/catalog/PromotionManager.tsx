import { useState, type FormEvent } from 'react'
import type { ClassificationKind } from '../../types/catalog'
import { QuickClassificationDialog } from './QuickClassificationDialog'
import type { Promotion } from '../../types/promotions'
import { useCatalog } from '../../hooks/useCatalog'
import { useStorageAction } from '../../hooks/useStorageAction'
import { promotionRepository } from '../../services/promotionRepository'
import { COMBO_LIMITS } from '../../services/comboRules'

import { ClassificationSelect } from './ClassificationSelect'
import { Modal } from '../Modal'
function emptyPromotion(): Promotion { return { id: crypto.randomUUID(), name: '', type: 'percentage', value: 0, productIds: [], categoryIds: [], familyIds: [], ipIds: [], minimumQuantity: 0, minimumAmount: 0, isActive: false, isArchived: false, isStackable: false, createdAt: '', updatedAt: '' } }
export function PromotionManager({ promotion, onClose, onSaved }: { promotion?: Promotion; onClose: () => void; onSaved: (message: string) => void }) {
  const [quickKind,setQuickKind] = useState<ClassificationKind>()
  const [quickBusy,setQuickBusy] = useState(false)
  const catalog = useCatalog(); const action = useStorageAction()
  const [draft, setDraft] = useState(() => promotion ? structuredClone(promotion) : emptyPromotion())
  const [value, setValue] = useState(promotion ? String(promotion.value) : '')
  const signature = JSON.stringify({ draft, value })
  const [initial] = useState(signature)
  const hasDraft = signature !== initial
  const patch = (input: Partial<Promotion>) => setDraft(current => ({ ...current, ...input }))
  const productOptions = catalog.products.map(product => ({ id: product.id, name: product.name, isActive: !product.isArchived, order: 0, createdAt: product.createdAt, updatedAt: product.updatedAt }))
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = value.trim().replace(',', '.')
    if (!(draft.type !== 'percentage' ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(raw)) { action.setError('Ingresa un descuento válido.'); return }
    void action.run(() => promotionRepository.save({ ...draft, value: Number(raw) }, promotion?.updatedAt), () => { onSaved('Promoción guardada.'); onClose() })
  }
  return <Modal title={promotion ? 'Editar promoción' : 'Nueva promoción'} onClose={onClose} busy={action.saving || quickBusy} protectChanges hasChanges={hasDraft}>
    {action.error && <p className="storage-error" role="alert">{action.error}</p>}
    <form className="catalog-form promotion-form" onSubmit={submit}><fieldset className="form-fields" disabled={action.saving}>
      <label>Nombre interno<input required maxLength={120} value={draft.name} onChange={e => patch({ name: e.target.value })} /></label>
      <label>Descripción (opcional)<textarea rows={2} maxLength={2000} value={draft.description ?? ''} onChange={e => patch({ description: e.target.value })} /></label>
      <div className="form-grid"><label>Tipo de descuento<select value={draft.type} onChange={e => { const type=e.target.value as Promotion['type']; setValue(''); patch({type,groupQuantity:type==='quantity'?2:undefined,components:type==='combo'?[{id:crypto.randomUUID(),kind:'product',targetId:'',quantity:1}]:undefined,productIds:[],categoryIds:[],familyIds:[],ipIds:[],minimumQuantity:0,minimumAmount:0}) }}><option value="percentage">Porcentaje (%)</option><option value="fixed">Monto fijo (CLP)</option><option value="quantity">Cantidad por precio fijo</option><option value="combo">Combo (precio fijo)</option></select></label><label>{draft.type==='quantity'?'Precio del grupo (CLP)':draft.type==='combo'?'Precio fijo del combo (CLP)':'Valor del descuento'}<input type="text" inputMode={draft.type !== 'percentage' ? 'numeric' : 'decimal'} required value={value} onChange={e => setValue(e.target.value)} /></label></div>
      {draft.type==='quantity' && <label>Unidades por grupo<input type="number" min="2" max="8" step="1" required value={draft.groupQuantity ?? 2} onChange={e=>patch({groupQuantity:Number(e.target.value)})} /><small>Ejemplo: 2 unidades por $1.000. Las unidades sueltas mantienen su precio. Máximo 24 unidades elegibles en el carrito; el motor avisa si la búsqueda excede sus límites.</small></label>}
      <ClassificationSelect label="Eventos" items={catalog.realEvents.map(event=>({...event,isActive:true,order:0}))} selected={draft.eventIds ?? []} onChange={ids=>patch({eventIds:ids})} emptyLabel="Todos" />
      {!!draft.eventIds?.length && <p className="muted">Solo se aplica con uno de estos eventos activo. Los productos con precio especial heredado para ese evento conservan esa excepción y no reciben esta promoción.</p>}
      {draft.type==='combo' ? <div className="combo-components"><strong>Componentes del combo</strong>{(draft.components??[]).map((component,index)=><div className="combo-component" key={component.id}><label>Tipo de componente<select value={component.kind} onChange={e=>patch({components:draft.components!.map(c=>c.id===component.id?{...c,kind:e.target.value as 'product'|'category',targetId:''}:c)})}><option value="product">Producto</option><option value="category">Categoría</option></select></label><label>Componente {index+1}<select required value={component.targetId} onChange={e=>patch({components:draft.components!.map(c=>c.id===component.id?{...c,targetId:e.target.value}:c)})}><option value="">Seleccionar</option>{(component.kind==='product'?productOptions:catalog.categories).filter(item=>item.isActive||item.id===component.targetId).map(item=><option key={item.id} value={item.id}>{item.name}{!item.isActive&&' (archivado)'}</option>)}</select></label><label>Cantidad requerida<input type="number" min="1" max="8" step="1" required value={component.quantity} onChange={e=>patch({components:draft.components!.map(c=>c.id===component.id?{...c,quantity:Number(e.target.value)}:c)})} /></label><button type="button" className="text-button" onClick={()=>patch({components:draft.components!.filter(c=>c.id!==component.id)})}>Quitar componente</button></div>)}<button type="button" className="button secondary" disabled={(draft.components?.length??0)>=4} onClick={()=>patch({components:[...(draft.components??[]),{id:crypto.randomUUID(),kind:'product',targetId:'',quantity:1}]})}>Agregar componente</button><p className="muted">Máximo 4 componentes y 8 unidades por aplicación. Se reconoce automáticamente y no tiene stock propio.</p><p className="stock-warning">Búsqueda exacta: hasta {COMBO_LIMITS.eligibleUnits} unidades elegibles, {COMBO_LIMITS.placements} asignaciones por combo y estado, y {COMBO_LIMITS.searchSteps.toLocaleString('es-CL')} pasos. Si se excede, hay que simplificar o desactivar reglas antes de cobrar.</p></div> : <>
      <div className="classification-fields product-associations"><ClassificationSelect label="Productos" items={productOptions} selected={draft.productIds} onChange={ids => patch({ productIds: ids })} assign emptyLabel="Todos" /><ClassificationSelect label="Categorías" items={catalog.categories} onCreate={() => setQuickKind('categories')} selected={draft.categoryIds} onChange={ids => patch({ categoryIds: ids })} assign emptyLabel="Todas" /><ClassificationSelect label="Familias" items={catalog.families} onCreate={() => setQuickKind('families')} selected={draft.familyIds} onChange={ids => patch({ familyIds: ids })} assign emptyLabel="Todas" /><ClassificationSelect label="IPs" items={catalog.ips} onCreate={() => setQuickKind('ips')} selected={draft.ipIds} onChange={ids => patch({ ipIds: ids })} assign emptyLabel="Todas" /></div>
      <p className="muted">Cada grupo vacío incluye todos. Deben cumplirse todos los grupos seleccionados; dentro de cada grupo basta una coincidencia.</p>
      <div className="form-grid"><label>Cantidad mínima elegible<input type="number" min="0" step="1" required value={draft.minimumQuantity} onChange={e => patch({ minimumQuantity: Number(e.target.value) })} /></label><label>Importe mínimo elegible (CLP)<input type="number" min="0" step="1" required value={draft.minimumAmount} onChange={e => patch({ minimumAmount: Number(e.target.value) })} /></label></div>
      <p className="muted">Los mínimos usan cantidades e importes originales de los productos elegibles, antes de descuentos.</p>
      </>}
      <div className="form-grid"><label>Desde (opcional)<input type="date" value={draft.startDate ?? ''} onChange={e => patch({ startDate: e.target.value || undefined })} /></label><label>Hasta (opcional)<input type="date" min={draft.startDate} value={draft.endDate ?? ''} onChange={e => patch({ endDate: e.target.value || undefined })} /></label></div>
      <p className="muted">Fechas inclusivas en Chile. {(draft.type==='combo'||draft.type==='quantity')?'El precio fijo se aplica a cada grupo completo; no se repiten unidades entre combos.':'El monto fijo se aplica una vez al conjunto elegible, hasta su importe restante.'}</p>
      <label className="check-label"><input type="checkbox" disabled={draft.isArchived} checked={draft.isActive} onChange={e => patch({ isActive: e.target.checked })} />Activa</label><label className="check-label"><input type="checkbox" checked={draft.isStackable} onChange={e => patch({ isStackable: e.target.checked })} />{(draft.type==='combo'||draft.type==='quantity')?'Compatible con promociones acumulables':'Acumulable sobre los mismos productos'}</label>
      <p className="muted">Máximo 12 activas. Los descuentos manuales se conservan.</p>
    </fieldset><div className="form-actions"><button type="button" className="button secondary" disabled={action.saving} data-close-modal>Cancelar</button><button className="button primary" disabled={action.saving}>Guardar promoción</button></div></form>
    {quickKind && <QuickClassificationDialog kind={quickKind} onBusy={setQuickBusy} onClose={() => setQuickKind(undefined)} onCreated={item => { const field = quickKind === 'categories' ? 'categoryIds' : quickKind === 'families' ? 'familyIds' : 'ipIds'; patch({[field]:[...new Set([...draft[field],item.id])]}); setQuickKind(undefined) }} />}
  </Modal>
}
