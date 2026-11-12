import { z } from 'zod'
import type { CatalogEvent } from '../../../types/events.ts'
import type { Promotion } from '../../../types/promotions.ts'
import type { Expense, ExpenseCategory, ExpenseChange } from '../../../types/expenses.ts'
import type { SharedSaleIntent, SharedVoidIntent } from './saleProtocol.ts'
export interface CommercialConfiguration {
  events: CatalogEvent[]; promotions: Promotion[]; expenses: Expense[]; expenseCategories: ExpenseCategory[]; expenseChanges: ExpenseChange[]
  packs: { productId: string; contents: { productId: string; quantity: number }[] }[]
  eventPrices: { productId: string; prices: { eventId: string; price: number }[] }[]
}
export interface ConfigurationRecord { revision: number; operationId: string; payload: CommercialConfiguration }
export interface ConfigurationIntent { operationId: string; actorUid: string; deviceId: string; expectedRevision: number; payload: CommercialConfiguration }
export type SalePending = ({ kind: 'sale'; intent: SharedSaleIntent } | { kind: 'void'; intent: SharedVoidIntent }) & { state: 'pending' | 'confirmed' | 'review'; error?: string; attempts: number }
export interface CommercialState {
  key: 'commerce'; ownerUid: string; workspaceId: string; deviceId: string; canWrite: boolean
  original: CommercialConfiguration
  baseline: ConfigurationRecord | null
  observed: CommercialConfiguration
  configurationPending?: ConfigurationIntent
  configurationError?: string
  configurationConflict?: boolean
  configurationResolutions?: { local: CommercialConfiguration; remote: ConfigurationRecord; choice: 'local' | 'remote'; at: string }[]
  operations: SalePending[]
  cursor?: { seconds: number; nanoseconds: number; id: string }
  lastConfirmed?: string
}
// Full payload and references are validated by backupValidation and the protocol at the boundary.
export const commercialStateSchema = z.object({ key: z.literal('commerce'), ownerUid: z.string().min(1), workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/), deviceId: z.uuid(), canWrite: z.boolean(),
  original: z.custom<CommercialConfiguration>(v => !!v && typeof v === 'object'), baseline: z.custom<ConfigurationRecord | null>(v => v === null || !!v && typeof v === 'object'), observed: z.custom<CommercialConfiguration>(v => !!v && typeof v === 'object'),
  configurationPending: z.custom<ConfigurationIntent>(v => !!v && typeof v === 'object').optional(), configurationError: z.string().optional(), configurationConflict: z.boolean().optional(),
  configurationResolutions: z.array(z.custom<NonNullable<CommercialState['configurationResolutions']>[number]>(v=>!!v&&typeof v==='object')).optional(),
  operations: z.array(z.custom<SalePending>(v => !!v && typeof v === 'object')),
  cursor: z.object({ seconds: z.number().int(), nanoseconds: z.number().int(), id: z.string() }).strict().optional(), lastConfirmed: z.string().optional(),
}).strict()
