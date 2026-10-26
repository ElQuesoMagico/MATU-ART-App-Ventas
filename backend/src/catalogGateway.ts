import { sign, equal } from './security.ts'
import { limitedText } from './gateway.ts'
import type { Env } from './types.ts'

/** Contract v2 preparation. Not routed/enabled until the matching GAS is deployed. */
export async function catalogGateway(env:Env,operation:string,data:unknown,send:typeof fetch=fetch):Promise<unknown> {
  if(!env.GAS_SECRET||!/^[a-f0-9]{64}$/.test(env.GAS_SECRET)||!env.WORKSPACE_ID||!['schema','initialize','read','publish'].includes(operation))throw new Error('NOT_CONFIGURED')
  const url=new URL(env.GAS_URL)
  if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)||url.search||url.hash)throw new Error('NOT_CONFIGURED')
  const requestId=crypto.randomUUID(),payload=JSON.stringify({version:2,requestId,timestamp:Date.now(),operation,workspaceId:env.WORKSPACE_ID,data})
  if(new TextEncoder().encode(payload).length>256000)throw new Error('REQUEST_TOO_LARGE')
  const signal=AbortSignal.timeout(12000)
  let response=await send(url,{method:'POST',redirect:'manual',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({keyId:env.GAS_KEY_ID,payload,signature:sign(`${env.GAS_KEY_ID}\n${payload}`,env.GAS_SECRET)})})
  if(response.status===302||response.status===303){const redirect=new URL(response.headers.get('Location')??'');if(redirect.origin!=='https://script.googleusercontent.com')throw new Error('INVALID_RESPONSE');response=await send(redirect,{method:'GET',redirect:'error',signal})}
  if(!response.ok)throw new Error('CONNECTION_FAILED')
  const envelope=JSON.parse(await limitedText(response,2_000_000))
  if(typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||envelope.keyId!==env.GAS_KEY_ID||!equal(sign(`response\n${env.GAS_KEY_ID}\n${envelope.payload}`,env.GAS_SECRET),envelope.signature))throw new Error('INVALID_RESPONSE')
  const body=JSON.parse(envelope.payload)
  if(body.version!==2||body.requestId!==requestId||body.workspaceId!==env.WORKSPACE_ID)throw new Error('INVALID_RESPONSE')
  if(body.ok!==true)throw new Error(['CONFLICT','NAME_CONFLICT','MISSING_REFERENCE','SCHEMA_INVALID','OPERATION_MISMATCH'].includes(body.error?.code)?body.error.code:'CONNECTION_FAILED')
  return body.data
}
