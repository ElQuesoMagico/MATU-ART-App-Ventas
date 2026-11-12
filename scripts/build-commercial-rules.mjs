import { readFile, writeFile } from 'node:fs/promises'
const base = await readFile(new URL('../firestore.inventory.rules', import.meta.url), 'utf8')
const fragment = await readFile(new URL('../tests/firebase/fixtures/sales.rules.fragment', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../tests/firebase/fixtures/configuration.rules.fragment', import.meta.url), 'utf8')
const marker = 'match /workspaces/{w} {'
if (base.split(marker).length !== 2) throw new Error('Unsafe rules composition')
await writeFile(new URL('../firestore.commercial.rules', import.meta.url), base.replace(marker, `${marker}\n${fragment}`))
