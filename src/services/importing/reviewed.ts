import type { ImportSource } from '../../types/imports.ts'
import type { CatalogProduct } from '../../types/catalog.ts'
import { normalizedName } from '../catalogValidation.ts'
import type { ImportChoices } from './plan.ts'

/** Human-reviewed on 2026-10-20; valid only for these original file bytes. */
export const reviewedSalesHash = '0fd952883c152f230ad0c15da65455e98d2adbc614cc3c6560f309b44a1c72d8'
const names: Record<string,string> = {
  'Hada Zelda':'Llavero Hada Zelda', 'Flan':'Gato Flan',
  'Libreta Frutiger Aero':'Libreta Frutiger Aero', 'Poster Gato Alien':'Poster Gato Alien',
  'Blind bag llavero gatos 2000':'Blind bag llavero gatos 2000',
  'Chapita Ramen':'Chapita Ramen', 'Chapita Kirby':'Chapita Kirby',
}
export function reviewedChoices(sources:ImportSource[],products:CatalogProduct[]):ImportChoices {
  const result:ImportChoices={}
  for(const source of sources) if(source.kind==='sales'&&source.hash===reviewedSalesHash) for(const row of source.rows) {
    if(['Pack Stickers Sanrio Calavera','Pack Stickers Madoka','Llavero grumpy cat'].some(name=>normalizedName(name)===normalizedName(row.Producto))){result[`sale-product:${normalizedName(row.Categoria)}:${normalizedName(row.Producto)}`]='pending';continue}
    const target=Object.entries(names).find(([name])=>normalizedName(name)===normalizedName(row.Producto))?.[1]
    if(!target)continue
    const matches=products.filter(p=>p.name===target)
    if(matches.length===1)result[`sale-product:${normalizedName(row.Categoria)}:${normalizedName(row.Producto)}`]=matches[0].id
  }
  return result
}
