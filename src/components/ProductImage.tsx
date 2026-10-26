import { useEffect, useState } from 'react'
import type { CatalogProduct } from '../types/catalog'
import { Ornament } from './Ornament'
export function ProductImage({ product, small = false }: { product: CatalogProduct; small?: boolean }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!product.image) return
    const next = URL.createObjectURL(product.image)
    queueMicrotask(() => setUrl(next))
    return () => URL.revokeObjectURL(next)
  }, [product.image])
  return <div className={`product-art peach ${small ? 'art-small' : ''}`}>
    {product.image && url ? <img src={url} alt={product.name} className="catalog-image" /> : <div className="product-placeholder"><Ornament kind="rosette" size={small ? 26 : 54} />{!small && <span>Sin imagen</span>}</div>}
  </div>
}
