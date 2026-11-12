import { readFile, writeFile } from 'node:fs/promises'
const base = await readFile(new URL('../firestore.catalog.rules', import.meta.url), 'utf8')
const fragment = await readFile(new URL('../tests/firebase/fixtures/inventory.rules.fragment', import.meta.url), 'utf8')
const marker = 'match /workspaces/{w} {'
if (base.split(marker).length !== 2) throw new Error('Cannot safely compose inventory and catalog rules')
await writeFile(new URL('../firestore.inventory.rules', import.meta.url), base.replace(marker, `${marker}\n${fragment}`))
console.log('Prepared firestore.inventory.rules; nothing deployed.')
