import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { EventRepository } from '../src/services/eventRepository.ts'
import { eventDateLabel, eventDateRange, historyEventOptions, saleMatchesEvent, validateEvent } from '../src/services/eventRules.ts'
import { CatalogRepository } from './catalogFixture.ts'
import { SalesRepository } from '../src/services/salesRepository.ts'
import { openCatalogDatabase } from '../src/services/catalogDatabase.ts'
import type { EventFields } from '../src/types/events.ts'
const id = () => crypto.randomUUID()
const fields = (name = 'Feria de ilustración'): EventFields => ({ name, description: 'Encuentro de ilustradores', location: 'Santiago', startDate: '2026-10-13', endDate: '2026-10-15' })
const repo = () => new EventRepository(`events-${id()}`)
test('evento válido: UUID estable, fechas de calendario y estado próximo; reintento sin duplicados', async () => {
  const events = repo(), uuid = id(), saved = await events.save(uuid, fields())
  assert.equal(saved.id, uuid); assert.equal(saved.status, 'upcoming'); assert.equal(saved.startDate, '2026-10-13'); assert.equal(saved.activatedAt, undefined)
  assert.deepEqual(await events.save(uuid, fields()), saved); assert.equal((await events.snapshot()).length, 1)
  await assert.rejects(events.save(uuid, fields('Otro')), /cambió/)
})
test('nombres y fechas inconsistentes se rechazan sin guardar', async () => {
  const events = repo()
  for (const patch of [{ name: '' }, { name: '  ' }, { endDate: '2026-10-12' }, { startDate: '2026-02-30' }, { endDate: '' }, { startDate: '13-10-2026' }]) await assert.rejects(events.save(id(), { ...fields(), ...patch }))
  assert.equal((await events.snapshot()).length, 0)
  validateEvent({ ...fields(), endDate: '2026-10-13' })
})
test('las etiquetas de días no se desplazan entre zonas horarias locales', () => {
  const previous = process.env.TZ
  try {
    for (const zone of ['America/Santiago', 'UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      process.env.TZ = zone
      assert.equal(eventDateLabel('2026-10-13'), '13 de octubre de 2026')
      assert.equal(eventDateLabel('2026-09-06'), '6 de septiembre de 2026')
      assert.equal(eventDateRange({ startDate: '2026-10-13', endDate: '2026-10-13' }), '13 de octubre de 2026')
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})
test('editar conserva identidad/estado; edición obsoleta no sobrescribe', async () => {
  const events = repo(), created = await events.save(id(), fields())
  const saved = await events.save(created.id, fields('Nombre editado'), created.updatedAt)
  assert.equal(saved.id, created.id); assert.equal(saved.createdAt, created.createdAt); assert.equal(saved.status, 'upcoming'); assert.notEqual(saved.updatedAt, created.updatedAt)
  await assert.rejects(events.save(created.id, fields('Obsoleto'), created.updatedAt), /otra pestaña/)
})
test('activar, reintento y restricción única de base de datos', async () => {
  const name = `active-${id()}`, events = new EventRepository(name), a = await events.save(id(), fields())
  const active = await events.activate(a.id, a.updatedAt)
  assert.equal(active.status, 'active'); assert.ok(active.activatedAt); assert.deepEqual(await events.activate(a.id, a.updatedAt), active)
  const db = await openCatalogDatabase(name)
  await assert.rejects(db.put('managedEvents', { ...active, id: id() }), /constraint|Constraint/i)
  assert.equal((await events.snapshot()).filter(event => event.status === 'active').length, 1); db.close()
})
test('dos activaciones concurrentes: solo una gana, la otra no cambia el anterior', async () => {
  const name = `concurrency-${id()}`, first = new EventRepository(name), second = new EventRepository(name)
  const a = await first.save(id(), fields('A')), b = await first.save(id(), fields('B'))
  const result = await Promise.allSettled([first.activate(a.id, a.updatedAt), second.activate(b.id, b.updatedAt)])
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(result.filter(r => r.status === 'rejected').length, 1)
  const snapshot = await first.snapshot(); assert.equal(snapshot.filter(event => event.status === 'active').length, 1); assert.equal(snapshot.filter(event => event.status === 'finished').length, 0)
})
test('cambiar activo requiere confirmación del anterior y no lo finaliza', async () => {
  const events = repo(), a = await events.save(id(), fields('A')), b = await events.save(id(), fields('B'))
  const active = await events.activate(a.id, a.updatedAt)
  await assert.rejects(events.activate(b.id, b.updatedAt), /Ya está activo/)
  await assert.rejects(events.activate(b.id, b.updatedAt, { id: active.id, updatedAt: a.updatedAt }), /Ya está activo/)
  const next = await events.activate(b.id, b.updatedAt, { id: active.id, updatedAt: active.updatedAt })
  const previous = (await events.snapshot()).find(event => event.id === a.id)!
  assert.equal(previous.status, 'upcoming'); assert.equal(previous.finishedAt, undefined); assert.equal(previous.activatedAt, active.activatedAt)
  assert.equal(next.status, 'active')
})
test('fallo durante cambio de activo revierte la desactivación anterior', async () => {
  const events = repo(), a = await events.save(id(), fields('A')), b = await events.save(id(), fields('B')), active = await events.activate(a.id, a.updatedAt)
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) { if (this.name === 'managedEvents' && (value as { id: string; status: string }).id === b.id && (value as { status: string }).status === 'active') throw new DOMException('Cuota', 'QuotaExceededError'); return put.call(this, value, key) }
  try { await assert.rejects(events.activate(b.id, b.updatedAt, { id: active.id, updatedAt: active.updatedAt })) }
  finally { IDBObjectStore.prototype.put = put }
  assert.deepEqual((await events.snapshot()).find(event => event.id === a.id), active)
  assert.equal((await events.snapshot()).find(event => event.id === b.id)?.status, 'upcoming')
})
test('dos cambios confirmados contra el mismo anterior: el segundo requiere nueva confirmación', async () => {
  const name = `switch-race-${id()}`, first = new EventRepository(name), second = new EventRepository(name)
  const a = await first.save(id(), fields('A')), b = await first.save(id(), fields('B')), c = await first.save(id(), fields('C')), active = await first.activate(a.id, a.updatedAt)
  const replace = { id: active.id, updatedAt: active.updatedAt }
  const result = await Promise.allSettled([first.activate(b.id, b.updatedAt, replace), second.activate(c.id, c.updatedAt, replace)])
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1)
  const snapshot = await first.snapshot(); assert.equal(snapshot.filter(e => e.status === 'active').length, 1); assert.equal(snapshot.find(e => e.id === a.id)?.status, 'upcoming')
})
test('desactivar conserva el evento; finalizar es irreversible y permite solo editar información', async () => {
  const events = repo(), a = await events.save(id(), fields()), active = await events.activate(a.id, a.updatedAt)
  const pending = await events.changeState(a.id, 'upcoming', active.updatedAt); assert.equal(pending.status, 'upcoming'); assert.equal(pending.finishedAt, undefined)
  const again = await events.activate(a.id, pending.updatedAt), finished = await events.changeState(a.id, 'finished', again.updatedAt)
  assert.ok(finished.finishedAt); assert.equal(finished.activeKey, undefined)
  await assert.rejects(events.activate(a.id, finished.updatedAt), /finalizado/)
  await assert.rejects(events.changeState(a.id, 'upcoming', finished.updatedAt), /finalizado/)
  const edit = await events.save(a.id, fields('Corregido'), finished.updatedAt)
  assert.equal(edit.status, 'finished'); assert.equal(edit.finishedAt, finished.finishedAt)
})
async function setup() {
  const name = `event-sales-${id()}`, events = new EventRepository(name), catalog = new CatalogRepository(name), sales = new SalesRepository(name)
  const product = await catalog.createProduct({ id: id(), name: 'Print', categoryIds: [], price: 1000, initialCost: 200, initialStock: 10, lowStockThreshold: 1, isFavorite: false })
  const checkout = () => ({ operationId: id(), items: [{ productId: product.id, quantity: 1, unitPrice: product.price, expectedRevision: product.revision }], payments: [{ method: 'cash' as const, amount: 1000 }] })
  return { name, events, catalog, sales, product, checkout }
}
test('venta sin evento permite registro; eventos legacy activos no se usan', async () => {
  const { name, catalog, sales, checkout } = await setup(), db = await openCatalogDatabase(name)
  await db.put('events', { id: id(), name: 'Evento anterior', isActive: true, createdAt: new Date().toISOString() }); db.close()
  const sale = await sales.confirm({ ...checkout(), eventId: id() }); assert.equal(sale.event, undefined)
  assert.equal((await sales.snapshot()).realEvents.length, 0); await catalog.close(); await sales.close()
})
test('evento se decide al confirmar; cambiarlo y editar nombre no cambia venta ni anulación; reintento estable', async () => {
  const { events, catalog, sales, checkout } = await setup()
  const a = await events.save(id(), fields('Primero')), b = await events.save(id(), fields('Segundo'))
  const active = await events.activate(a.id, a.updatedAt), prepared = checkout()
  const current = await events.activate(b.id, b.updatedAt, { id: a.id, updatedAt: active.updatedAt })
  const sale = await sales.confirm(prepared); assert.deepEqual(sale.event, { id: b.id, name: 'Segundo' })
  const renamed = await events.save(b.id, fields('Nombre nuevo'), current.updatedAt)
  await events.changeState(b.id, 'finished', renamed.updatedAt)
  assert.deepEqual(await sales.confirm(prepared), sale)
  const voided = await sales.voidSale({ saleId: sale.id, operationId: id(), reason: 'Verificación', returnStock: true })
  assert.deepEqual(voided.event, sale.event); assert.deepEqual(voided.payments, sale.payments); assert.equal(voided.total, 1000)
  assert.equal((await catalog.snapshot()).products[0].stock, 10); await catalog.close(); await sales.close()
})
test('venta simultánea con cambio de evento usa el estado serializado dentro de la transacción', async () => {
  const { name, events, catalog, sales, checkout } = await setup()
  const other = new EventRepository(name), a = await events.save(id(), fields('A')), b = await events.save(id(), fields('B')), active = await events.activate(a.id, a.updatedAt)
  // Importa el orden real de transacciones, no el orden de invocación de promesas:
  // una conexión ya abierta puede iniciar antes que otra que aún se está abriendo.
  const transaction = IDBDatabase.prototype.transaction, starts: string[] = []
  IDBDatabase.prototype.transaction = function(stores, mode, options) {
    const names = typeof stores === 'string' ? [stores] : [...stores]
    if (this.name === name && mode === 'readwrite' && names.includes('managedEvents')) starts.push(names.includes('sales') ? 'sale' : 'event')
    return transaction.call(this, stores, mode, options)
  }
  try {
    const [next, sale] = await Promise.all([other.activate(b.id, b.updatedAt, { id: a.id, updatedAt: active.updatedAt }), sales.confirm(checkout())])
    assert.equal(next.status, 'active'); assert.deepEqual(sale.event, starts[0] === 'event' ? { id: b.id, name: 'B' } : { id: a.id, name: 'A' })
    const fresh = (await catalog.snapshot()).products[0], request = checkout(); request.items[0].expectedRevision = fresh.revision
    starts.length = 0
    const [second] = await Promise.all([sales.confirm(request), other.changeState(b.id, 'finished', next.updatedAt)])
    assert.deepEqual(second.event, starts[0] === 'sale' ? { id: b.id, name: 'B' } : undefined)
    const pending = (await events.snapshot()).find(e => e.id === a.id)!, lastActive = await events.activate(a.id, pending.updatedAt)
    const latest = (await catalog.snapshot()).products[0], lastRequest = checkout(); lastRequest.items[0].expectedRevision = latest.revision
    starts.length = 0
    const [, without] = await Promise.all([other.changeState(a.id, 'finished', lastActive.updatedAt), sales.confirm(lastRequest)])
    assert.deepEqual(without.event, starts[0] === 'event' ? undefined : { id: a.id, name: 'A' })
  } finally { IDBDatabase.prototype.transaction = transaction; await catalog.close(); await sales.close() }
})
test('filtros históricos incluyen finalizados, sin evento y referencias antiguas sin crear eventos', async () => {
  const { events, catalog, sales, checkout } = await setup()
  const a = await events.save(id(), fields()), active = await events.activate(a.id, a.updatedAt), sale = await sales.confirm(checkout())
  const finished = await events.changeState(a.id, 'finished', active.updatedAt)
  const legacy = { ...sale, id: id(), event: { id: 'evt-demo-antiguo', name: 'Nombre histórico' } }, none = { ...sale, id: id(), event: undefined }
  const options = historyEventOptions([finished], [sale, legacy, none])
  assert.equal(options.find(e => e.id === a.id)?.historical, false); assert.equal(options.find(e => e.id === legacy.event.id)?.historical, true)
  assert.deepEqual([sale, legacy, none].filter(s => saleMatchesEvent(s, a.id)), [sale])
  assert.deepEqual([sale, legacy, none].filter(s => saleMatchesEvent(s, 'none')), [none])
  assert.equal((await events.snapshot()).length, 1); await catalog.close(); await sales.close()
})
test('persistencia tras cerrar conexiones/reabrir y operación con red deshabilitada', async () => {
  const { name, events, catalog, sales, checkout } = await setup(), fetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Sin conexión') }
  try {
    const a = await events.save(id(), fields()), active = await events.activate(a.id, a.updatedAt), sale = await sales.confirm(checkout())
    await catalog.close(); await sales.close()
    assert.deepEqual((await new EventRepository(name).snapshot())[0], active)
    const reopened = new SalesRepository(name); assert.deepEqual((await reopened.snapshot()).sales[0], sale)
    await reopened.voidSale({ saleId: sale.id, operationId: id(), reason: 'Sin red', returnStock: false })
    await events.changeState(a.id, 'finished', active.updatedAt); await reopened.close()
  } finally { globalThis.fetch = fetch; await catalog.close(); await sales.close() }
})
test('migración v7→v8 no convierte eventos mínimos ni reescribe almacenes anteriores', async () => {
  const { name, catalog, sales, checkout } = await setup()
  const sale = await sales.confirm(checkout()); await catalog.close(); await sales.close()
  const source = await openCatalogDatabase(name), stores = [...source.objectStoreNames].filter(s => !['managedEvents', 'expenses', 'expenseChanges', 'expenseCategories', 'importRecords'].includes(s))
  const data = new Map<string, unknown[]>(), schema = stores.map(store => {
    const tx = source.transaction(store as 'products'), objectStore = tx.objectStore(store as 'products')
    return { store, keyPath: objectStore.keyPath, indexes: [...objectStore.indexNames].map(index => { const i = objectStore.index(index as 'active-name'); return { name: index, keyPath: i.keyPath, unique: i.unique } }) }
  })
  for (const store of stores) data.set(store, await source.getAll(store as 'products')); source.close()
  const legacyName = `event-migration-${id()}`, legacy = await openDB(legacyName, 7, { upgrade(db) { for (const s of schema) { const store = db.createObjectStore(s.store, { keyPath: s.keyPath }); for (const index of s.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique }) } } })
  for (const [store, rows] of data) for (const row of rows) await legacy.put(store, row)
  const oldEvent = { id: id(), name: 'Odisea anterior', isActive: true, createdAt: new Date().toISOString() }
  await legacy.put('events', oldEvent)
  const historical = { ...sale, event: { id: 'evt-odisea', name: 'Odisea de ejemplo' } }; await legacy.put('sales', historical); legacy.close()
  const createStore = IDBDatabase.prototype.createObjectStore
  IDBDatabase.prototype.createObjectStore = function(store, options) { if (store === 'managedEvents') throw new DOMException('Sin espacio', 'QuotaExceededError'); return createStore.call(this, store, options) }
  try { await assert.rejects(openCatalogDatabase(legacyName)) } finally { IDBDatabase.prototype.createObjectStore = createStore }
  const unchanged = await openDB(legacyName, 7); assert.equal(unchanged.version, 7); assert.equal(unchanged.objectStoreNames.contains('managedEvents'), false); assert.deepEqual(await unchanged.get('sales', sale.id), historical); unchanged.close()
  for (let i = 0; i < 2; i++) {
    const db = await openCatalogDatabase(legacyName); assert.equal(db.version, 10); assert.deepEqual(await db.getAll('managedEvents'), [])
    assert.deepEqual(await db.get('sales', sale.id), historical); assert.deepEqual(await db.get('events', oldEvent.id), oldEvent)
    for (const [store, rows] of data) if (!['sales', 'events'].includes(store)) assert.deepEqual(await db.getAll(store as 'products'), rows)
    db.close()
  }
  const events = new EventRepository(legacyName), real = await events.save(id(), fields('Evento posterior')), active = await events.activate(real.id, real.updatedAt)
  const current = new CatalogRepository(legacyName), product = (await current.snapshot()).products[0], newSales = new SalesRepository(legacyName)
  const request = checkout(); request.items[0].expectedRevision = product.revision
  assert.deepEqual((await newSales.confirm(request)).event, { id: active.id, name: active.name })
  const voided = await newSales.voidSale({ saleId: sale.id, operationId: id(), reason: 'Anterior', returnStock: false })
  assert.deepEqual(voided.event, historical.event); await current.close(); await newSales.close()
})
