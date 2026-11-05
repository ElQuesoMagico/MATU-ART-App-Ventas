import type { LocalView } from './catalogLocal.ts'
import type { RemoteRecord } from './catalogModel.ts'
import { stable } from './catalogModel.ts'

/** A live listener is not evidence that every local record is shared. */
export function catalogDiagnostics(local:LocalView, remote:Record<string,RemoteRecord>) {
  return [...new Set([...Object.keys(local.records),...Object.keys(remote),...Object.keys(local.invalid)])].map(key=>{
    const here=local.records[key],cloud=remote[key],base=local.state?.baseline[key]
    const excluded=!!local.state?.excluded.includes(key)
    const status=excluded?'Excluido de sincronización':local.invalid[key]?'Dato local inválido':local.state?.conflicts[key]?'Conflicto':local.state?.pending[key]?'Pendiente de envío':
      !here?'Solo en la nube':!cloud?'Solo local':stable(here)!==stable(cloud.payload)?'Diferencias local/nube':base?.revision!==cloud.revision?'Coincide · revisión por confirmar':'Coincide y confirmado'
    return {key,local:here,remote:cloud?.payload,localRevision:base?.revision,remoteRevision:cloud?.revision,status,excluded}
  })
}
