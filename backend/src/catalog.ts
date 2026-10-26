import { catalogOperation, catalogAck, catalogSnapshot, schemaReport, stable } from '../../src/services/cloud/catalogContract.ts'
import { digest } from './security.ts'
import type { Env, Session } from './types.ts'
import { catalogGateway } from './catalogGateway.ts'
export async function catalogRequest(path:string,body:unknown,env:Env,session:Session,gateway=catalogGateway) {
  if(!env.WORKSPACE_ID||!/^[a-f0-9-]{36}$/.test(env.WORKSPACE_ID))throw new Error('NOT_CONFIGURED')
  if(session.role!=='administrator')throw new Error('FORBIDDEN')
  if(path==='schema'||path==='initialize'||path==='read'){
    if(stable(body)!==(path==='initialize'?'{"confirm":true}':'{}'))throw new Error('INVALID_REQUEST')
    const data=await gateway(env,path,{actorId:session.id})
    return (path==='read'?catalogSnapshot:schemaReport).parse(data)
  }
  if(path!=='publish')throw new Error('NOT_FOUND')
  const operation=catalogOperation.parse(body),hash=digest(stable(operation))
  await env.DB.prepare("INSERT INTO catalog_operations(operation_id,workspace_id,actor_id,payload_hash,status,created_at) VALUES(?,?,?,?,'pending',?) ON CONFLICT(operation_id) DO NOTHING").bind(operation.operationId,env.WORKSPACE_ID,session.id,hash,Date.now()).run()
  const journal=await env.DB.prepare('SELECT * FROM catalog_operations WHERE operation_id=?').bind(operation.operationId).first<{workspace_id:string;actor_id:string;payload_hash:string;status:string;response_json:string|null}>()
  if(!journal||journal.workspace_id!==env.WORKSPACE_ID||journal.actor_id!==session.id||journal.payload_hash!==hash)throw new Error('OPERATION_MISMATCH')
  if(journal.status==='confirmed')return catalogAck.parse(JSON.parse(journal.response_json!))
  if(journal.status==='conflict')throw new Error('CONFLICT')
  try {
    const result=catalogAck.parse(await gateway(env,'publish',{actorId:session.id,operation,payloadHash:hash}))
    if(result.operationId!==operation.operationId||result.workspaceId!==env.WORKSPACE_ID||result.records.length!==operation.changes.length)throw new Error('INVALID_RESPONSE')
    for(const change of operation.changes){const record=result.records.find(r=>r.record.entity===change.record.entity&&r.record.payload.id===change.record.payload.id);if(!record||stable(record.record)!==stable(change.record)||record.revision!==(change.expectedRevision??0)+1)throw new Error('INVALID_RESPONSE')}
    await env.DB.prepare("UPDATE catalog_operations SET status='confirmed',response_json=?,confirmed_at=? WHERE operation_id=? AND payload_hash=?").bind(JSON.stringify(result),Date.now(),operation.operationId,hash).run()
    return result
  }catch(error){if(error instanceof Error&&['CONFLICT','NAME_CONFLICT','MISSING_REFERENCE'].includes(error.message))await env.DB.prepare("UPDATE catalog_operations SET status='conflict' WHERE operation_id=? AND status='pending'").bind(operation.operationId).run();throw error}
}
