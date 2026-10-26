export interface Statement {
 bind(...values: (string | number | null)[]): Statement
 first<T>(): Promise<T | null>
 run(): Promise<unknown>
}
export interface Database { prepare(sql: string): Statement }
export interface Env {
 DB: Database
 APP_ORIGIN: string
 GAS_URL: string
 GAS_KEY_ID: string
 GAS_SECRET?: string
 WORKSPACE_ID?: string
}
export type Role = 'administrator' | 'manager' | 'seller'
export interface Account { id: string; username: string; password_hash: string; role: Role; disabled: number }
export interface Session extends Account { csrf: string; expires_at: number }
