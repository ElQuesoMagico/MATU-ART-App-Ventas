import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { classificationOptions, sameClassificationSelection, toggleClassification } from '../src/services/selectionRules.ts'
import { promotionAudience, promotionEvents, promotionStatus } from '../src/services/promotionPresentation.ts'
import { productFormErrors, initialProductCosts } from '../src/services/productFormRules.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { PromotionRepository } from '../src/services/promotionRepository.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { EventRepository } from '../src/services/eventRepository.ts'
import type { Promotion } from '../src/types/promotions.ts'
const id=()=>crypto.randomUUID()
const option=(name:string,isActive=true)=>({id:id(),name,isActive,order:0,createdAt:'',updatedAt:''})
test('selector: múltiples alternan sin mutar la selección inicial; único conserva una categoría',()=>{
 const initial=['a']; const multiple=toggleClassification(initial,'b');assert.deepEqual(initial,['a']);assert.deepEqual(multiple,['a','b']);assert.deepEqual(toggleClassification(multiple,'a'),['b'])
 assert.deepEqual(toggleClassification(multiple,'c',true),['c']);assert.deepEqual(toggleClassification(['c'],'c',true),['c'])
})
test('selector: búsqueda preserva asociaciones y las archivadas existentes siguen consultables',()=>{
 const a=option('Print'),b=option('Sticker'),archived=option('Colección anterior',false),newArchived=option('Otra archivada',false)
 const selected=[a.id,archived.id]
 assert.deepEqual(classificationOptions([a,b,archived,newArchived],selected,' sticker ',true),[b]);assert.deepEqual(selected,[a.id,archived.id])
 assert.deepEqual(classificationOptions([a,b,archived,newArchived],selected,'',true),[a,b,archived])
 assert.deepEqual(classificationOptions([a,b,archived,newArchived],selected,'',false),[a,b,archived,newArchived])
 assert.ok(sameClassificationSelection(selected,[archived.id,a.id]));assert.ok(!sameClassificationSelection(selected,[a.id]))
})
test('selector: borrador cancelado no modifica selección; crear agrega sin perder selecciones',()=>{
 const selected=['a','b'];const draft=toggleClassification(selected,'c');assert.deepEqual(selected,['a','b']);assert.deepEqual(draft,['a','b','c'])
 assert.ok(!sameClassificationSelection(draft,selected));assert.ok(sameClassificationSelection(toggleClassification(draft,'c'),selected))
})
test('producto sin costo: clasificaciones y edición de estimado persisten sin modificar costos históricos',async()=>{
 const db=`ux63-${id()}`,catalog=new CatalogRepository(db)
 const category=await catalog.saveCategory({id:id(),name:'Sticker',isActive:true,order:0})
 const values={name:'Sin costo',categoryId:category.id,price:'800',cost:'',stock:'5',threshold:'1'}
 assert.deepEqual(productFormErrors(values,[]),{})
 const product=await catalog.createProduct({id:id(),name:values.name,categoryIds:[],categoryId:category.id,price:800,initialStock:5,lowStockThreshold:1,isFavorite:false,...initialProductCosts('')})
 const movements=await catalog.listMovements({productId:product.id})
 assert.equal(product.averageCost,undefined);assert.equal(product.lastKnownCost,undefined)
 const updated=await catalog.updateProduct(product.id,{...product,estimatedUnitCost:250},product.revision)
 assert.equal(updated.averageCost,undefined);assert.equal(updated.lastKnownCost,undefined);assert.deepEqual(await catalog.listMovements({productId:product.id}),movements)
 await catalog.close();assert.equal((await catalog.snapshot()).products[0].estimatedUnitCost,250);assert.equal((await catalog.snapshot()).products[0].categoryId,category.id);await catalog.close()
})
test('tarjetas: destinatarios, componentes, eventos y estado se presentan sin mutar configuración',async()=>{
 const db=`labels63-${id()}`,catalog=new CatalogRepository(db),events=new EventRepository(db)
 const product=await catalog.createProduct({id:id(),name:'Sticker',categoryIds:[],price:800,initialStock:0,lowStockThreshold:1,isFavorite:false})
 const category=(await catalog.snapshot()).categories[0],event=await events.save(id(),{name:'Feria',startDate:'2026-10-13',endDate:'2026-10-13'})
 const labels={products:[product],categories:[category],families:[],ips:[],events:[event]}
 const p:Promotion={id:id(),name:'Oferta',type:'percentage',value:10,productIds:[product.id],categoryIds:[category.id],familyIds:[],ipIds:[],eventIds:[event.id],minimumQuantity:0,minimumAmount:0,isActive:true,isArchived:false,isStackable:false,createdAt:'',updatedAt:''},before=structuredClone(p)
 assert.deepEqual(promotionAudience(p,labels),['Productos: Sticker','Categorías: Categoría de prueba']);assert.equal(promotionEvents(p,[event]),'Feria');assert.equal(promotionStatus(p),'Activa');assert.equal(promotionStatus({...p,isArchived:true}),'Archivada')
 assert.deepEqual(promotionAudience({...p,type:'combo',components:[{id:id(),kind:'product',targetId:product.id,quantity:2}]},labels),['2 × Sticker']);assert.deepEqual(p,before);await catalog.close()
})
test('edición y archivo desde administración conservan snapshots de promociones vendidas y anuladas',async()=>{
 const db=`promos63-${id()}`,catalog=new CatalogRepository(db),repo=new PromotionRepository(db),sales=new SalesRepository(db)
 const product=await catalog.createProduct({id:id(),name:'Print',categoryIds:[],price:1000,initialStock:2,lowStockThreshold:1,isFavorite:false})
 const original=await repo.save({id:id(),name:'Original',type:'percentage',value:10,productIds:[product.id],categoryIds:[],familyIds:[],ipIds:[],minimumQuantity:0,minimumAmount:0,isActive:true,isArchived:false,isStackable:false,createdAt:'',updatedAt:''})
 const sale=await sales.confirm({operationId:id(),items:[{productId:product.id,quantity:1,unitPrice:1000,expectedRevision:product.revision}],payments:[{method:'cash',amount:900}]})
 const edited=await repo.save({...original,name:'Editada desde tarjeta',value:20},original.updatedAt)
 await repo.save({...edited,isArchived:true,isActive:false},edited.updatedAt);await catalog.close();await sales.close()
 assert.deepEqual((await sales.snapshot()).sales[0],sale);assert.equal((await repo.snapshot())[0].isArchived,true)
 const voided=await sales.voidSale({saleId:sale.id,operationId:id(),reason:'QA',returnStock:true});assert.deepEqual(voided.appliedPromotions,sale.appliedPromotions);assert.deepEqual(voided.payments,sale.payments);await catalog.close();await sales.close()
})
