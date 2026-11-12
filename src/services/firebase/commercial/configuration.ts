import { dataSchema } from '../../data/backupValidation.ts'
import { stable } from '../catalogModel.ts'
import type { CommercialConfiguration } from './commercialState.ts'
import { z } from 'zod'
import { validatePromotion } from '../../promotionConditions.ts'
export function validateConfiguration(value: unknown): CommercialConfiguration {
  const schema = z.object({ events: dataSchema.shape.managedEvents, promotions: dataSchema.shape.promotions, expenses: dataSchema.shape.expenses,
    expenseCategories: dataSchema.shape.expenseCategories, expenseChanges: dataSchema.shape.expenseChanges,
    packs: z.array(z.object({productId:z.uuid(),contents:z.array(z.object({productId:z.uuid(),quantity:z.number().int().positive().safe()}).strict())}).strict()),
    eventPrices: z.array(z.object({ productId: z.uuid(), prices: z.array(z.object({ eventId: z.uuid(), price: z.number().int().min(0).max(1_000_000_000) }).strict()) }).strict()),
  }).strict()
  const config = schema.parse(value) as CommercialConfiguration
  if (new TextEncoder().encode(JSON.stringify(config)).length > 500_000) throw new Error('La configuración comercial supera el límite compartido de 500 KB.')
  if(config.events.length>1000||config.promotions.length>1000||config.expenses.length>2000||config.expenseCategories.length>100||config.expenseChanges.length>5000||config.eventPrices.length>2000||config.packs.length>2000)throw new Error('La configuración supera los límites del protocolo compartido.')
  config.promotions.forEach(validatePromotion)
  for (const rows of [config.events, config.promotions, config.expenses, config.expenseCategories, config.expenseChanges]) if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Identificadores comerciales repetidos.')
  if (config.events.filter(e => e.status === 'active').length > 1 || config.events.some(e => (e.status === 'active') !== (e.activeKey === 'active') || e.endDate < e.startDate)) throw new Error('Estado de eventos inconsistente.')
  if(new Set(config.packs.map(p=>p.productId)).size!==config.packs.length)throw new Error('Packs duplicados.')
  const events = new Set(config.events.map(e => e.id)), categories = new Set(config.expenseCategories.map(e => e.id))
  if (new Set(config.eventPrices.map(p => p.productId)).size !== config.eventPrices.length) throw new Error('Precios de producto duplicados.')
  for (const p of config.eventPrices) if (new Set(p.prices.map(p => p.eventId)).size !== p.prices.length || p.prices.some(p => !events.has(p.eventId))) throw new Error('Precio especial sin evento válido.')
  for (const p of config.promotions) if (p.eventIds?.some(id => !events.has(id))) throw new Error('Promoción sin evento válido.')
  for (const e of config.expenses) {
    if (!categories.has(e.categoryId) || e.eventId && !events.has(e.eventId)) throw new Error('Gasto con referencia pendiente.')
    const history = config.expenseChanges.filter(c => c.expenseId === e.id).sort((a,b) => a.after.revision - b.after.revision)
    if (!history.length || stable(history.at(-1)!.after) !== stable(e)) throw new Error('Gasto sin auditoría completa.')
    history.forEach((change,index) => { if (change.after.revision !== index+1 || (index === 0 ? change.before !== undefined : stable(change.before) !== stable(history[index-1].after))) throw new Error('Auditoría de gasto inconsistente.') })
  }
  return config
}
