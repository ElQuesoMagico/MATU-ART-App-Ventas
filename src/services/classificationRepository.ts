import { openCatalogDatabase } from './catalogDatabase.ts'
import { CatalogError, integer, normalizedName, validId, validName } from './catalogValidation.ts'
import type { CatalogClassification, ClassificationKind, ClassificationSnapshot } from '../types/catalog.ts'
export class ClassificationRepository {
  private readonly databaseName?: string
  constructor(databaseName?: string) { this.databaseName = databaseName }
  async snapshot(): Promise<ClassificationSnapshot> {
    const db = await openCatalogDatabase(this.databaseName)
    try {
      const tx = db.transaction(['categories', 'families', 'ips'], 'readonly')
      const [categories, families, ips] = await Promise.all([tx.objectStore('categories').getAll(), tx.objectStore('families').getAll(), tx.objectStore('ips').getAll()])
      await tx.done
      const sort = (items: CatalogClassification[]) => items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es'))
      return { categories: categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es')), families: sort(families), ips: sort(ips) }
    } finally { db.close() }
  }
  async save(kind: ClassificationKind, input: { id: string; name: string; description?: string; order: number; isActive: boolean; expectedUpdatedAt?: string }): Promise<CatalogClassification> {
    if (!['categories', 'families', 'ips'].includes(kind)) throw new CatalogError('Clasificación inválida.')
    validId(input.id); validName(input.name); integer(input.order, 'Orden')
    if (typeof input.isActive !== 'boolean' || (input.description?.length ?? 0) > 2000) throw new CatalogError('Revisa el estado y la descripción (hasta 2.000 caracteres).')
    const db = await openCatalogDatabase(this.databaseName)
    const tx = db.transaction(kind, 'readwrite'); void tx.done.catch(() => {})
    try {
      const store = tx.objectStore(kind)
      const previous = await store.get(input.id)
      const key = normalizedName(input.name)
      // Incluye archivadas. Versiones anteriores podían contener duplicados archivados:
      // se preservan en migración y se permite mantener su nombre, nunca crear otro duplicado.
      const duplicates = await store.index('by-name').getAll(key)
      if (duplicates.some(item => item.id !== input.id) && (previous?.normalizedName !== key || (!previous.isActive && input.isActive))) throw new CatalogError(`Ya existe ${kind === 'categories' ? 'una categoría' : kind === 'families' ? 'una familia' : 'una IP'} con ese nombre, incluso entre las archivadas.`)
      if (previous && input.expectedUpdatedAt !== previous.updatedAt) throw new CatalogError('La clasificación cambió en otra ventana. Vuelve a abrir la edición.')
      const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
      const item: CatalogClassification = { id: input.id, name: input.name.trim(), description: input.description?.trim() || undefined, order: input.order, isActive: input.isActive, normalizedName: key, createdAt: previous?.createdAt ?? now, updatedAt: now }
      const saved = kind === 'categories' ? { ...item, activeName: input.isActive ? key : undefined } : item
      await store.put(saved); await tx.done; return saved
    } catch (error) { try { tx.abort() } catch { /* Transacción completada. */ } await tx.done.catch(() => {}); throw error }
    finally { db.close() }
  }
}
export const classificationRepository = new ClassificationRepository()
