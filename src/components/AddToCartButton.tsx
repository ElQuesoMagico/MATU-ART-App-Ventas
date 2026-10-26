import { useState } from 'react'
import { Icon } from './Icon'

// Feedback visual local; la operación del carrito la sigue controlando useCart.
export function AddToCartButton({ name, disabled, onAdd }: { name: string; disabled: boolean; onAdd: () => void }) {
  const [press, setPress] = useState(0)
  return <button className="button add-button" disabled={disabled} onClick={() => { onAdd(); setPress(value => value + 1) }} aria-label={`Agregar ${name} al carrito`}>
    {disabled ? 'Límite de stock' : 'Agregar'}<span key={press} className={press ? 'add-feedback' : ''}><Icon name="plus" size={18} /></span>
  </button>
}
