import { openCatalogDatabase } from './catalogDatabase.ts'
import { CatalogError, normalizedName } from './catalogValidation.ts'
import { validatePromotion, MAX_ACTIVE_PROMOTIONS } from './promotionRules.ts'
import type { Promotion } from '../types/promotions.ts'
export class PromotionRepository {
  private readonly name?: string
  constructor(name?: string) { this.name = name }
  async snapshot() { const db = await openCatalogDatabase(this.name); try { return (await db.getAll('promotions')).sort((a,b) => a.name.localeCompare(b.name,'es')) } finally { db.close() } }
  async save(input: Promotion, expectedUpdatedAt?: string) {
    validatePromotion(input)
    const db = await openCatalogDatabase(this.name)
    const tx = db.transaction(['promotions','products','categories','families','ips','managedEvents'], 'readwrite'); void tx.done.catch(() => {})
    try {
      const previous = await tx.objectStore('promotions').get(input.id)
      if (previous && previous.updatedAt !== expectedUpdatedAt) throw new CatalogError('La promoción cambió. Vuelve a abrirla.')
      for (const [store, ids, existing] of [['products',input.productIds,previous?.productIds ?? []],['categories',input.categoryIds,previous?.categoryIds ?? []],['families',input.familyIds,previous?.familyIds ?? []],['ips',input.ipIds,previous?.ipIds ?? []]] as const) {
        for (const id of ids) { const item = await tx.objectStore(store).get(id); const active = item && ('isArchived' in item ? !item.isArchived : item.isActive); if (!item || (!active && !existing.includes(id))) throw new CatalogError('Un destinatario está archivado o no existe.') }
      }
      for (const id of input.eventIds ?? []) if (!await tx.objectStore('managedEvents').get(id)) throw new CatalogError('Un evento seleccionado ya no existe.')
      for(const component of input.components ?? []) {
        const store=component.kind==='product'?'products':'categories'
        const item=await tx.objectStore(store).get(component.targetId)
        const previousRef=previous?.components?.some(c=>c.kind===component.kind&&c.targetId===component.targetId)
        if(!item || ((!('isArchived' in item ? !item.isArchived : item.isActive))&&!previousRef)) throw new CatalogError('Un componente del combo está archivado o no existe.')
      }
      const all = await tx.objectStore('promotions').getAll()
      if (all.some(p => p.id !== input.id && normalizedName(p.name) === normalizedName(input.name)) && normalizedName(previous?.name ?? '') !== normalizedName(input.name)) throw new CatalogError('Ya existe una promoción con ese nombre, incluso archivada.')
      if (input.isActive && !input.isArchived && all.filter(p => p.id !== input.id && p.isActive && !p.isArchived).length >= MAX_ACTIVE_PROMOTIONS) throw new CatalogError('Se permiten hasta 12 promociones activas. Desactiva otra primero.')
      const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt)+1 : 0)).toISOString()
      const saved = { ...input, name: input.name.trim(), description: input.description?.trim() || undefined, isActive: input.isArchived ? false : input.isActive, createdAt: previous?.createdAt ?? now, updatedAt: now }
      await tx.objectStore('promotions').put(saved); await tx.done; return saved
    } catch(error) { try { tx.abort() } catch { /* Completada. */ } await tx.done.catch(() => {}); throw error } finally { db.close() }
  }
}
export const promotionRepository = new PromotionRepository()
