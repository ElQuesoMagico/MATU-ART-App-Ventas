import { firebaseConnection } from '../client'
import { inventoryView, receiveInventory, markInventoryAttempt, setInventoryPermission } from './inventoryLocal'
import { stable } from '../catalogModel'
import type { FirebaseRole } from '../access'
let dispose: (() => void) | undefined
let wake: (() => void) | undefined
let identity = '', lastError = ''
export const inventoryStatus = () => ({ error: lastError, automatic: !!identity })
export const wakeInventory = () => wake?.()
export function stopInventory() { dispose?.(); dispose = undefined; wake = undefined; identity = ''; lastError = '' }
export function notifyInventory() {
  window.dispatchEvent(new Event('catalog-cloud-updated'))
  window.dispatchEvent(new Event('inventory-updated'))
  try { const channel = new BroadcastChannel('clown-ufo-catalog'); channel.postMessage('inventory'); channel.close() } catch { /* focus refresh remains */ }
}
export function startInventory(uid: string, role: FirebaseRole) {
  const client = firebaseConnection()
  if (!client?.inventoryEnabled) return
  if (identity === `${uid}:${role}`) { wake?.(); return }
  stopInventory(); identity = `${uid}:${role}`
  let active = true, running = false, listener: (() => void) | undefined, cursorKey = '', retryAt = 0, failures = 0
  let releaseLeader: (() => void) | undefined, leader = false
  const transport = client.inventory()
  const tick = async () => {
    if (!active || !leader || running || !navigator.onLine || Date.now() < retryAt || client.identity() !== uid) return
    running = true
    try {
      await navigator.locks.request('matu-inventory-write', async () => {
        const view = await inventoryView(), state = view.state
        if (!active || !state || state.ownerUid !== uid || state.workspaceId !== client.workspaceId) return
        await setInventoryPermission(uid,role!=='seller')
        const key = stable(state.cursor ?? null)
        if (!listener || cursorKey !== key) {
          listener?.(); cursorKey = key
          listener = transport.watchPage(state.cursor, rows => {
            void navigator.locks.request('matu-inventory-write', async () => {
              if (!active || client.identity() !== uid || cursorKey !== key) return
              const current = (await inventoryView()).state
              if (stable(current?.cursor ?? null) !== key) return
              await receiveInventory(rows, uid, client.workspaceId)
              failures = 0; retryAt = 0; lastError = ''
              listener?.(); listener = undefined; notifyInventory()
            }).then(() => { void tick() }).catch(fail)
          }, cause => { listener?.(); listener = undefined; fail(cause) })
        }
        if (role === 'seller') return
        // One intent per product dependency chain, in durable insertion order.
        const op = state.operations.find(op => op.state === 'pending' && !state.operations.some(other => other.intent.productId === op.intent.productId && other.state === 'conflict'))
        if (!op) return
        try {
          await markInventoryAttempt(op.intent.operationId, uid)
          await transport.commit(op.intent)
          const confirmed = await transport.confirmed(op.intent.operationId)
          if (!active || client.identity() !== uid) return // next session recovers receipt by the same ID
          await receiveInventory([confirmed], uid, client.workspaceId)
          failures = 0; retryAt = 0; lastError = ''; notifyInventory()
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'No se pudo compartir.'
          // Network/permission errors retain the SAME operation, including ambiguous server commits.
          const conflict = /inventario cambió|ya está incorporado|no está disponible|Identificador de operación/.test(message)
          await markInventoryAttempt(op.intent.operationId, uid, message, conflict, undefined, false)
          fail(cause); notifyInventory()
        }
      })
    } catch (cause) { fail(cause) } finally { running = false }
  }
  function fail(cause: unknown) { lastError = cause instanceof Error ? cause.message : 'No se pudo actualizar el inventario.'; retryAt = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(++failures, 5)) }
  const elect = () => {
    if (!active || leader) return
    void navigator.locks.request('matu-inventory-leader', { ifAvailable: true }, async lock => {
      if (!lock || !active) return
      leader = true
      await new Promise<void>(resolve => { releaseLeader = resolve; void tick() })
      leader = false
    })
  }
  const online = () => { retryAt = 0; elect(); void tick() }
  const changed = () => { elect(); void tick() }
  wake = online
  const timer = window.setInterval(() => { elect(); void tick() }, 2000)
  window.addEventListener('online', online); window.addEventListener('inventory-updated', changed)
  dispose = () => { active = false; listener?.(); releaseLeader?.(); clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('inventory-updated', changed) }
  elect()
}
