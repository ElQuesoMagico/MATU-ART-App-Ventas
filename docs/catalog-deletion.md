# Eliminación compartida del catálogo

Preparación: 17-11-2026. Publicación: 18-11-2026.

## Verificación realizada

- TypeScript (`tsc -b`), lint y build Pages: aprobados.
- Pruebas locales: 332/332. Una prueba legacy no forma parte de este commit;
  GitHub Actions ejecutará la batería disponible en el repositorio publicado.
- Firebase Emulator Suite (Auth + Firestore): 33/33.
- Eliminación de categorías, familias/IPs vacías y productos; revisiones obsoletas;
  idempotencia, permisos, recibos inmutables, reconexión del listener y asociaciones.
- Reasignación previa; conservación de filas y costos locales; cambios offline
  conservados como conflicto; tombstones en respaldos; rechazo de resurrección.
- Venta histórica y anulación posterior: pagos y movimientos conservados, devolución
  compensatoria de stock y permanencia del marcador de producto retirado.
- No se realizaron eliminaciones de registros reales ni pruebas en teléfonos físicos.
- Continúa la advertencia preexistente de chunks mayores de 500 KB.

## Publicación

Firebase CLI confirmó publicación de `firestore.commercial.rules` en `matu-art`.
Las reglas catálogo/inventario/comercio se generan desde sus fuentes y fragmentos;
no sustituir producción por las reglas legacy de `firebase.json`.
Frontend: GitHub Pages, workflow `pages.yml`; resultado registrado al terminar.
No se activaron servicios de pago ni se migró IndexedDB (v13).

## Uso

1. Abrir o recargar MATU ART en cada dispositivo para recibir el nuevo protocolo.
2. Con sesión de administrador/encargado y conexión, abrir Eliminar en el catálogo.
3. Revisar dependencias. Reasignar categorías o desvincular familias/IPs explícitamente.
4. Esperar que esos cambios se confirmen y volver a abrir la revisión.
5. Escribir el nombre y confirmar Eliminar definitivamente.
6. El registro desaparece de las listas operativas de los dispositivos conectados;
   las ventas, movimientos, costos y recibos históricos permanecen.

Si otro dispositivo tenía cambios pendientes, conservará un conflicto comprensible.
Elegir la versión compartida descarta esos cambios; no existe restauración del UUID
eliminado. No borrar datos del navegador ni editar Firestore manualmente.

## Límites explícitos

Esta entrega cubre productos, categorías, familias e IPs. No completa el borrado
compartido de promociones/combos, eventos o categorías de gastos: siguen bajo sus
restricciones actuales. El pedido amplio de todas las entidades no está terminado.
Ventas, pagos, movimientos y auditorías no se eliminan.

Los tombstones conservan la copia del catálogo necesaria para interpretar referencias;
no hay purga ni liberación del nombre reservado. Cuentan en el límite actual de 2.000
registros por tipo. Los clientes anteriores no podrán escribir sin el control de
revisiones nuevo: deben recargar; sus colas no se borran.

Las dependencias se revisan en el cliente sobre lecturas confirmadas, con control
transaccional de revisiones. Las Rules verifican roles, terminalidad, recibos y stock;
no validan exhaustivamente el grafo comercial de un cliente manipulado.

## Resultado de publicación — 18-11-2026

- Commit funcional: `f27c938e48c8511c45b92341736868bf61352579`.
- GitHub Pages: workflow 44444983821, `completed / success`.
- URL comprobada: https://elquesomagico.github.io/MATU-ART-App-Ventas/
- Bundle servido: `assets/index-SN6kW7jP.js`; contiene el protocolo
  `catalogControl/revision` y el nuevo diálogo de eliminación compartida.
- Reglas Firestore: despliegue CLI confirmado en `matu-art`.
- Validación local final: 332/332; emuladores: 33/33; TypeScript, lint y build aprobados.
- Verificación de producción de solo lectura; cero eliminaciones comerciales reales.
