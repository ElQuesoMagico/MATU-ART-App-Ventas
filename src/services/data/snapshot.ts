import { openCatalogDatabase, type CatalogSchema } from '../catalogDatabase.ts'

export const stores = ['products', 'categories', 'families', 'ips', 'movements', 'costChanges', 'sales', 'payments', 'metadata', 'events', 'managedEvents', 'promotions', 'expenses', 'expenseCategories', 'expenseChanges', 'importRecords'] as const
export type StoreName = typeof stores[number]
export type DataSnapshot = { [K in StoreName]: CatalogSchema[K]['value'][] }
export const emptySnapshot = (): DataSnapshot => Object.fromEntries(stores.map(name => [name, []])) as unknown as DataSnapshot
export function assertStoreSet(names: Iterable<string>) {
  if ([...names].sort().join('|') !== [...stores].sort().join('|')) throw new Error('La estructura local cambió. Actualiza MATU ART antes de respaldar o restaurar.')
}
/** One transaction, including every entity, not the React/visible snapshot. */
export async function readData(name?: string): Promise<DataSnapshot> {
  const db = await openCatalogDatabase(name)
  try {
    assertStoreSet(db.objectStoreNames)
    const tx = db.transaction([...stores], 'readonly')
    const entries = await Promise.all(stores.map(async key => [key, await tx.objectStore(key).getAll()]))
    await tx.done
    return Object.fromEntries(entries) as DataSnapshot
  } finally { db.close() }
}
export function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value instanceof Blob) return JSON.stringify({ blobSize: value.size, blobType: value.type })
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a<b?-1:a>b?1:0).map(([key,v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
/** Catalog writes always change revision/timestamp when changing an image. */
export function snapshotToken(data: DataSnapshot) { return canonical(data) }
export function assertNoPendingOperations(data: DataSnapshot) {
  const recognized = new Set(['sale-number', 'event-price-revision', 'combos-packs-v1'])
  if (data.metadata.some(row => !recognized.has(row.key))) throw new Error('Hay metadatos u operaciones locales no reconocidos. La restauración se bloqueó para no perder operaciones pendientes.')
}
