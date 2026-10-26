export type CloudRole = 'administrator' | 'manager' | 'seller'
export interface CloudSession {user:{id:string;username:string;role:CloudRole}; csrf:string; expiresAt:string}
export interface CloudStatus {status:'available';version:1}
export interface ConnectionResult {schemaVersion:1;ready:boolean}
/** Contract only: no outbox, device ID generation or sync is enabled in 8.1. */
export interface FutureSyncOperation {
  version:1
  operationId:string
  deviceId:string
  workspaceId:string
  createdAt:string
  entityType:'product'|'classification'|'promotion'|'event'|'sale'|'payment'|'movement'|'expense'|'costChange'
  entityId:string
  operationType:'create'|'update'|'archive'|'void'|'compensate'
  expectedRevision:number | null
  recordRevision:number
  payload:unknown
  status:'pending'|'confirmed'|'conflict'
  attempts:number
  nextAttemptAt?:string
  acknowledgement?:{operationId:string;serverRevision:number;confirmedAt:string}
}
