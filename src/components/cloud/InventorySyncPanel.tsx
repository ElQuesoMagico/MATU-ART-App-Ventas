import { useEffect, useRef, useState } from 'react'
import { firebaseConnection } from '../../services/firebase/client'
import type { FirebaseRole } from '../../services/firebase/access'
import { firebaseMessage } from '../../services/firebase/access'
import { inventoryView, linkInventory, cancelInventoryConflict, receiveInventory, type InventorySelection } from '../../services/firebase/commercial/inventoryLocal'
import { inventoryStatus, notifyInventory, startInventory, wakeInventory } from '../../services/firebase/commercial/inventoryRuntime'
import { stable } from '../../services/firebase/catalogModel'
import type { InventoryBalance } from '../../services/firebase/commercial/inventoryProtocol'

export function InventorySyncPanel({ uid, role }: { uid: string; role: FirebaseRole }) {
  const client = firebaseConnection()
  const [view, setView] = useState<Awaited<ReturnType<typeof inventoryView>>>()
  const [preview, setPreview] = useState<{ local: Awaited<ReturnType<typeof inventoryView>>; remote: Record<string, InventoryBalance> }>()
  const [choices, setChoices] = useState<Record<string, InventorySelection>>({})
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    const refresh = () => { void inventoryView().then(value => { if (active) setView(value) }).catch(cause => { if(active)setError(firebaseMessage(cause)) }) }
    refresh(); const timer = setInterval(refresh, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  if (!client?.inventoryEnabled) return null
  const state = view?.state, pending = state?.operations.filter(op => op.state === 'pending') ?? [], conflicts = state?.operations.filter(op => op.state === 'conflict') ?? []
  const permitted = !state || (state.ownerUid === uid && state.workspaceId === client.workspaceId)
  async function run(action: () => Promise<void>) {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setMessage('')
    try { await action();setView(await inventoryView()) } catch(cause) { setError(firebaseMessage(cause)) }
    finally { lock.current=false;setBusy(false) }
  }
  async function compare() {
    const access = await client!.verify()
    if(client!.identity()!==uid)throw new Error('La sesión cambió.')
    startInventory(uid,access.role)
    setPreview({ local: await inventoryView(), remote: await client!.inventory().read() });setChoices({});setConfirmed(false)
  }
  const name = (id: string) => view?.products.find(p=>p.id===id)?.name ?? 'Producto'
  return <section className="data-manager">
    <h3>Inventario compartido</h3>
    <p>{state ? `${state.products.length} productos vinculados · ${pending.length} pendientes · ${conflicts.length} requieren revisión` : 'Sin vincular. No se publican las cantidades locales automáticamente.'}</p>
    <p className="local-note">{navigator.onLine ? 'Los movimientos se comparten automáticamente después de incorporar el producto.' : 'Sin conexión. Las operaciones guardadas se conservan para reintentar.'}</p>
    <p className="stock-warning">Los productos incorporados requieren ventas compartidas. Vincula también la configuración comercial para venderlos; nunca se descontarán solo en este dispositivo.</p>
    {!permitted && <p role="alert">Este inventario está vinculado a otra cuenta o espacio. Inicia sesión con la cuenta original; sus operaciones se conservan.</p>}
    {state?.lastConfirmed && <p>Última confirmación: {new Date(state.lastConfirmed).toLocaleString('es-CL')}</p>}
    <button type="button" className="button secondary" disabled={busy || !navigator.onLine || !permitted} onClick={()=>void run(compare)}>Comparar inventario e incorporar productos</button>
    <button type="button" className="button secondary" disabled={busy || !navigator.onLine || !permitted} onClick={()=>void run(async()=>{const access=await client.verify();startInventory(uid,access.role);wakeInventory();setMessage('Reintento solicitado. Los movimientos siguen pendientes hasta recibir confirmación.')} )}>Reintentar conexión</button>
    {preview && <div>
      <p>Selecciona únicamente productos cuyo inventario quieras compartir. Se conservan movimientos y saldos anteriores en el respaldo de incorporación. No se importan ventas.</p>
      <div className="movement-list">{preview.local.products.filter(p=>!p.isArchived&&!preview.local.state?.products.includes(p.id)).map(p=>{
        const remote=preview.remote[p.id], choice=choices[p.id]
        return <article key={p.id}>
          <label><input type="checkbox" checked={!!choice} disabled={busy || (!remote&&role==='seller')} onChange={event=>setChoices(previous=>{const next={...previous};if(event.target.checked)next[p.id]={productId:p.id,action:remote?'receive':'unknown'};else delete next[p.id];return next})}/>{p.name}</label>
          <p>Este dispositivo: {p.stockCountPending?'Pendiente de conteo':p.stock} · Compartido: {remote ? remote.countPending?'Pendiente de conteo':remote.stock : 'Sin incorporar'}</p>
          {choice && (remote ? <p>Recibir el saldo y costos compartidos. No sobrescribe la nube.</p> : <>
            <label>Incorporar como<select value={choice.action} disabled={busy} onChange={event=>setChoices(previous=>({...previous,[p.id]:{productId:p.id,action:event.target.value as 'unknown'|'count'}}))}><option value="unknown">Pendiente de conteo físico</option><option value="count">Existencias contadas y confirmadas</option></select></label>
            {choice.action==='count'&&<label>Conteo físico confirmado<input type="number" inputMode="numeric" min="-1000000000" max="1000000000" step="1" value={choice.quantity??''} disabled={busy} onChange={event=>setChoices(previous=>({...previous,[p.id]:{...choice,quantity:event.target.value===''?undefined:Number(event.target.value)}}))}/></label>}
            <p className="local-note">Los costos de apertura quedarán desconocidos; los costos locales anteriores se conservan en la auditoría de incorporación.</p>
          </>)}
        </article>
      })}</div>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>Confirmo estos saldos y acepto que los productos seleccionados no podrán venderse durante D2.</label>
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setPreview(undefined)}>Cancelar</button><button type="button" className="button primary" disabled={busy||!confirmed||!Object.keys(choices).length||!navigator.onLine} onClick={()=>void run(async()=>{
        const access=await client.verify(), current=await client.inventory().read()
        if(client.identity()!==uid||stable(current)!==stable(preview.remote))throw new Error('El inventario remoto cambió. Vuelve a comparar antes de incorporar.')
        await navigator.locks.request('matu-inventory-write',()=>linkInventory(Object.values(choices),current,preview.local.token,client.workspaceId,uid,access.role!=='seller'))
        setPreview(undefined);startInventory(uid,access.role);notifyInventory();wakeInventory();setMessage('Vinculación guardada. Los conteos nuevos quedan pendientes hasta confirmarse en la nube.')
      })}>Confirmar incorporación</button></div>
    </div>}
    {!!pending.length&&<details><summary>Operaciones pendientes ({pending.length})</summary>{pending.map(op=><p key={op.intent.operationId}>{name(op.intent.productId)} · {op.intent.type==='initialize'?'Incorporación':op.intent.type==='count'?'Conteo':op.intent.type==='restock'?'Reposición':'Ajuste'} · {op.intent.quantity}{op.error&&' · No se pudo compartir; se reintentará.'}</p>)}</details>}
    {conflicts.map(op=><article className="stock-warning" key={op.intent.operationId}>
      <strong>{name(op.intent.productId)} · Requiere revisión</strong>
      <p>Solicitado: {op.intent.quantity}. Saldo compartido: {state?.baseline[op.intent.productId]?.countPending?'Pendiente de conteo':state?.baseline[op.intent.productId]?.stock??'No disponible'}. Se conserva el movimiento original.</p>
      <p>Descartar esta intención también descarta las operaciones posteriores pendientes del mismo producto. Después puedes registrar el valor revisado desde Ajustar stock.</p>
      <button type="button" className="button secondary" disabled={busy||!navigator.onLine||!permitted||role==='seller'} onClick={()=>void run(async()=>{
        if(!window.confirm('¿Descartar esta intención y sus operaciones posteriores pendientes? Se conserva su auditoría.'))return
        await client.verify()
        await navigator.locks.request('matu-inventory-write',async()=>{
          const receipt=await client.inventory().receipt(op.intent.operationId)
          if(receipt)await receiveInventory([await client.inventory().confirmed(op.intent.operationId)],uid,client.workspaceId)
          else await cancelInventoryConflict(op.intent.operationId,uid)
        })
        notifyInventory();setMessage('Revisión guardada. Consulta el saldo actual antes de registrar otro movimiento.')
      })}>Descartar intención y revisar</button>
    </article>)}
    {(error||inventoryStatus().error)&&<p className="storage-error" role="alert">{error||'No se pudo compartir el inventario. Se conservaron los movimientos; revisa conexión y permisos.'}</p>}
    {message&&<p role="status">{message}</p>}{busy&&<p role="status">Procesando…</p>}
  </section>
}
