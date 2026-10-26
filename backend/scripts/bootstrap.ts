import { passwordHash, normalizeUsername } from '../src/security.ts'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (!process.stdin.isTTY) throw new Error('Ejecutar desde un terminal interactivo; no enviar contraseñas por argumentos.')
const remote = process.argv.includes('--remote')
if (!remote && !process.argv.includes('--local')) throw new Error('Indicar --local o --remote explícitamente.')
const rl = createInterface({input:process.stdin,output:process.stdout})
const username = normalizeUsername(await rl.question('Usuario del primer administrador: '))
if (!/^[a-z0-9._@+-]{3,100}$/.test(username)) throw new Error('Usuario inválido')
if (await rl.question(`Crear el primer administrador en D1 ${remote ? 'PRODUCCIÓN' : 'LOCAL'} (escribir CREAR): `) !== 'CREAR') process.exit(1)
rl.close()
function hiddenPassword(): Promise<string> {
  process.stdout.write('Contraseña (16–256 caracteres, no se mostrará): ')
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8')
  return new Promise((resolve,reject) => {
    let result = ''
    const listener = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\r' || char === '\n') {
          process.stdin.removeListener('data',listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n')
          if (char === '\u0003') reject(new Error('Cancelado')); else resolve(result)
          return
        }
        if (char === '\u007f' || char === '\b') result = result.slice(0,-1)
        else if (char >= ' ' && result.length < 257) result += char
      }
    }
    process.stdin.on('data',listener)
  })
}
const password = await hiddenPassword()
if (password.length < 16 || password.length > 256) throw new Error('Longitud inválida')
const hash = passwordHash(password)
const directory = await mkdtemp(join(tmpdir(),'matu-bootstrap-'))
try {
  const path = join(directory,'bootstrap.sql')
  // Atomic, first administrator ONLY; no public bootstrap HTTP endpoint or token.
  await writeFile(path,`INSERT INTO users(id,username,password_hash,role,created_at) SELECT '${randomUUID()}','${username}','${hash}','administrator',${Date.now()} WHERE NOT EXISTS(SELECT 1 FROM users); SELECT COUNT(*) AS account_count FROM users;`,{mode:0o600})
  const result = spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','matu-art-auth',remote?'--remote':'--local','--file',path],{stdio:'inherit'})
  if (result.status !== 0) throw new Error('No se pudo provisionar D1')
  console.log('Procedimiento finalizado. Si ya había usuarios, no se modificaron. Verificar el acceso; no hay registro público.')
} finally { await unlink(join(directory,'bootstrap.sql')).catch(()=>{}); await rmdir(directory) }
