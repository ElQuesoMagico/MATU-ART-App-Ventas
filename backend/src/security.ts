import { scryptSync, randomBytes, timingSafeEqual, createHash, createHmac } from 'node:crypto'
// OWASP scrypt alternative: N=2^14, r=8, p=5 (~16 MiB). Server only.
export function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  return `scrypt-v1$${salt}$${scryptSync(password, salt, 32, { N:16384, r:8, p:5, maxmem:32*1024*1024 }).toString('hex')}`
}
export const dummyHash = 'scrypt-v1$00000000000000000000000000000000$' + '00'.repeat(32)
export function verifyPassword(password: string, encoded: string) {
  if (!/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded)) throw new Error('Invalid verifier')
  return equal(passwordHash(password, encoded.split('$')[1]), encoded)
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
export const token = () => randomBytes(32).toString('hex')
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const sign = (message: string, secret: string) => createHmac('sha256', secret).update(message).digest('hex')
export const normalizeUsername = (name: string) => name.trim().toLowerCase()
