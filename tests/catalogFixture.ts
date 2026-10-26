// Fixtures explícitas para las pruebas anteriores a la categoría principal obligatoria.
import { CatalogRepository as RealCatalogRepository } from '../src/services/catalogRepository.ts'
import type { CreateProductInput } from '../src/types/catalog.ts'
export class CatalogRepository extends RealCatalogRepository {
  private categorySetup?: Promise<void>
  async createProduct(input: CreateProductInput) {
    let categoryId = input.categoryId ?? input.categoryIds[0]
    if (!categoryId) {
      categoryId = '00000000-0000-4000-8000-000000000001'
      this.categorySetup ??= (async () => {
        const categories = (await this.snapshot()).categories
        if (!categories.some(item => item.id === '00000000-0000-4000-8000-000000000001')) await this.saveCategory({ id: '00000000-0000-4000-8000-000000000001', name: 'Categoría de prueba', order: 0, isActive: true }).catch(async error => { if (!(await this.snapshot()).categories.some(item => item.id === '00000000-0000-4000-8000-000000000001')) throw error })
      })()
      await this.categorySetup
    }
    return super.createProduct({ ...input, categoryId })
  }
}
