import type { Product } from '../types'
import { artisticAssets } from '../assets/artisticAssets'
/** Legacy demo artwork; never seeds the real catalog. */
export function ProductArt({ product, small = false }: { product: Product; small?: boolean }) {
  return <div className={`product-art ${product.color} ${small ? 'art-small' : ''}`}><svg viewBox="0 0 180 150" fill="none" aria-hidden="true"><use href={`${artisticAssets.productSamples}#product-${product.art}`} /></svg></div>
}
