import { z } from 'zod'
import { inventoryBalanceSchema, inventoryIntentSchema } from './inventoryProtocol.ts'
export const inventoryReceiptSchema = z.object({ intent: inventoryIntentSchema, before: inventoryBalanceSchema.nullable(), after: inventoryBalanceSchema, quantityChange: z.number().int().safe() }).strict()
export const inventoryStateSchema = z.object({
  key: z.literal('inventory'), workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/), ownerUid: z.string().min(1), deviceId: z.uuid(), canWrite: z.boolean(),
  products: z.array(z.uuid()), baseline: z.record(z.string(), inventoryBalanceSchema),
  originals: z.record(z.string(), z.object({ stock: z.number().int(), countPending: z.boolean(), averageCost: z.number().nullable(), lastKnownCost: z.number().nullable(), estimatedUnitCost: z.number().nullable(), provisional: z.boolean() }).strict()),
  operations: z.array(z.object({ intent: inventoryIntentSchema, state: z.enum(['pending','confirmed','conflict','cancelled']), attempts: z.number().int().nonnegative(), error: z.string().optional(), confirmedAt: z.string().optional() }).strict()),
  cursor: z.object({ seconds: z.number().int(), nanoseconds: z.number().int(), id: z.string() }).strict().optional(),
  lastConfirmed: z.string().optional(),
}).strict()
export type InventorySyncState = z.infer<typeof inventoryStateSchema>
export type InventoryCursor = NonNullable<InventorySyncState['cursor']>
export interface ReceivedInventory { receipt: z.infer<typeof inventoryReceiptSchema>; cursor: InventoryCursor }
