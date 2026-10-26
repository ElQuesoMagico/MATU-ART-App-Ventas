import { useState } from 'react'
import type { ManualDiscount } from '../types/discounts'
import { applyManualDiscount } from '../services/discountRules'
import { storageError } from '../services/catalogValidation'
import { discountLabel } from '../utils/discounts'
export function DiscountEditor({ label, baseAmount, discount, onChange }: { label: string; baseAmount: number; discount?: ManualDiscount; onChange: (discount?: ManualDiscount) => void }) {
  const [editing, setEditing] = useState(false)
  const [type, setType] = useState<ManualDiscount['type']>('percentage')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  function open() { setType(discount?.type ?? 'percentage'); setValue(discount ? String(discount.value) : ''); setError(''); setEditing(true) }
  function apply() {
    try {
      const normalized = value.trim().replace(',', '.')
      if (!(type === 'fixed' ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(normalized)) throw new Error('invalid')
      const next = { type, value: Number(normalized) }; applyManualDiscount(baseAmount, next)
      onChange(next); setEditing(false); setError('')
    } catch (error) { setError(error instanceof Error && error.message === 'invalid' ? 'Ingresa un importe válido.' : storageError(error)) }
  }
  return <div className="manual-discount">
    {!editing ? <><button type="button" className="text-button" aria-label={`${discount ? 'Editar' : 'Agregar'} descuento ${label}`} onClick={open}>{discount ? `Descuento ${discountLabel(discount)}` : 'Agregar descuento'}</button>{discount && <button type="button" className="text-button" aria-label={`Quitar descuento ${label}`} onClick={() => onChange(undefined)}>Quitar</button>}</> : <div className="discount-controls"><label>Tipo de descuento<select aria-label={`Tipo de descuento ${label}`} value={type} onChange={event => setType(event.target.value as ManualDiscount['type'])}><option value="percentage">Porcentaje (%)</option><option value="fixed">Monto (CLP)</option></select></label><label>Valor<input type="text" inputMode={type === 'fixed' ? 'numeric' : 'decimal'} aria-label={`Valor de descuento ${label}`} value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} /></label><div className="discount-buttons"><button type="button" className="button secondary" onClick={apply}>Aplicar</button><button type="button" className="text-button" onClick={() => setEditing(false)}>Cancelar</button></div>{error && <p className="stock-warning" role="alert">{error}</p>}</div>}
  </div>
}
