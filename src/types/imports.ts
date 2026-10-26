export type ImportKind = 'catalog' | 'families' | 'ips' | 'sales'
export interface ImportSource { kind:ImportKind; name:string; hash:string; rows:Record<string,string>[] }
export interface ImportRecord {
  id:string
  sourceKey:string
  sourceHash:string
  sourceName:string
  kind:ImportKind | 'event'
  row:number
  targetId:string
  batchId:string
  createdAt:string
  original:Record<string,string>
}
export interface HistoricalSource { recordId:string; batchId:string; file:string; hash:string; row:number; importedAt:string; original:Record<string,string> }
