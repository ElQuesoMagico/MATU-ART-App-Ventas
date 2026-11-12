# Hito D — D1: auditoría y diseño de sincronización comercial

## Integración D2 + D3 + D4 — 12-11-2026 (estado vigente)

Se integraron inventario, configuración comercial, ventas y anulaciones compartidas.
Este apartado sustituye los estados D2-only y bloqueos de D3 de las notas históricas
conservadas más abajo. Arquitectura operativa: React/IndexedDB + Auth/Firestore Spark
+ GitHub Pages. No se activaron servicios de pago ni infraestructura legacy.

- IndexedDB **v13**, migración aditiva `commercialSync` sobre `inventorySync` v12.
  El índice de número de venta deja de ser único: dos dispositivos pueden emitir el
  mismo número visible; UUID de venta/operación y dispositivo identifican cada registro.
- Cola durable y recibos idempotentes. Confirmación comercial únicamente después
  del recibo de Firestore; ventas pendientes quedan fuera de estadísticas confirmadas.
- Conteos, ajustes, reposiciones, eventos/activo/cierre, gastos, promociones/combos,
  precios por evento y composición de packs utilizan los repositorios existentes.
  Ventas y pagos conservan copias históricas; anulaciones compensan solo unidades
  efectivamente descontadas. Pagos originales no se borran ni implican reembolso.
- Incorporación inicial explícita desde Mi cuenta. No se subieron existencias,
  ventas históricas ni otros datos comerciales reales durante el desarrollo.
- Listeners paginados, liderazgo entre pestañas, transacciones y reintentos estables.
  Conflictos de inventario/configuración requieren revisión; no gana el último reloj.

Ver [procedimiento, límites y verificación](shared-commerce-deployment.md).
Código principal: `src/services/firebase/commercial/`, `salesRepository.ts`,
`catalogDatabase.ts`, adaptadores de respaldo, Bootstrap/CloudConnection,
InventorySyncPanel/CommercialSyncPanel, StockForm, MovementHistory, Checkout,
SaleDetail/StoredSaleList, POS y analytics. Reglas generadas en
`firestore.commercial.rules`, configuración explícita `firebase.commercial.json`.

Verificación local: **324/324 pruebas**, **27/27 Auth/Firestore en emuladores**,
TypeScript, lint y build Pages aprobados. Una prueba local pertenece a trabajo legacy
no incluido en esta publicación; CI ejecutará 323. El emulador anterior produjo un
fallo de limpieza; con instancia nueva la batería completa pasó. Se probaron dos
IndexedDB aisladas y listeners del SDK contra emuladores, no dos teléfonos físicos.
Revisión visual no ejecutada: herramienta de navegador no disponible.
Advertencia de tamaño de bundle >500 kB pendiente de optimización.

Estado de publicación: reglas y frontend publicados; consultar el registro al final de
`docs/shared-commerce-deployment.md`. No confundir pruebas emuladas con producción.


## Continuación D2 integrada — 2026-11-11

El candidato descrito abajo ya tiene integración local: formularios existentes, cola
durable IndexedDB v12, incorporación explícita, listener paginado, estados y respaldo.
El usuario autorizó bloquear ventas de productos incorporados a D2 hasta integrar ventas
compartidas; así se puede ensayar D2 sin adelantar D3/D4 ni sobrescribir descuentos locales.
Se conserva el texto anterior como historia, no como estado vigente de implementación.

Ver [D2: procedimiento, migración, pruebas y límites](inventory-d2-deployment.md).
Reglas compuestas preparadas en firestore.inventory.rules, no publicadas. Activación
deshabilitada por defecto; ninguna existencia real incorporada. Prueba emulada integrada
realizada; revisión visual y dos dispositivos físicos pendientes. No declarar D2 terminado
en producción ni continuar D3 antes de cerrar el piloto.

## Decisión vigente: Hito D definitivo, 2026-11-10

**Este apartado reemplaza el bloqueo de validación exhaustiva descrito más abajo.**
El usuario acepta cálculo de importes, descuentos y combos en el cliente para una o
dos personas de confianza. Se mantienen GitHub Pages, Firebase Auth/Firestore Spark
e IndexedDB; no usar Worker/D1/GAS/Sheets/Functions ni activar facturación.
No se requiere otra decisión de arquitectura para continuar. El código legacy se
conserva sin convertirlo en dependencia operativa. Auditoría ayuda a detectar errores;
no prueba integridad contra un usuario autorizado que manipule su cliente.

Roles previstos: administrador/encargado administran inventario, costos, eventos,
promociones y gastos; vendedor registra ventas y consulta información operativa.
Anulaciones y cambios financieros privilegiados requieren administrador/encargado.
Permisos deberán demostrarse para cada operación antes de habilitarla. No cambiar roles
desde el navegador. El fragmento candidato D2 permite lectura de inventario/costos a
miembros habilitados, como la información actualmente visible en Inventario; no promete
privacidad por campo. Si se restringen costos por rol, separarlos antes de publicación.

### Implementación técnica inicial D2 (todavía no conectada a producción)

- `inventoryProtocol.ts`: contratos estrictos versionados y planificador puro para
  apertura pendiente de conteo, conteo, ajuste y reposición. Reutiliza restockCost;
  su firma ahora acepta solo los cuatro campos que usa, sin cambiar su cálculo.
- `inventoryRemote.ts`: transacción de dos documentos, saldo confirmado y recibo
  inmutable con movimiento completo (antes/después, delta, intención, actor, dispositivo,
  fecha original, revisión y hora servidor). Reintento idéntico devuelve recibo; otro
  contenido con mismo ID rechaza. Listener ignora caché/escrituras sin confirmar.
- Rules **candidatas exclusivamente de emulador** en
  `tests/firebase/fixtures/inventory.rules.fragment`, integradas con reglas C por el test.
  Rechazan anónimo/vendedor para ajustes, saldo sin recibo, recibo sin saldo, revisión
  antigua, delta incorrecto, edición/borrado de recibos y escalamiento de rol.
  Validan rango/tipo de costos, preservación del costo estimado y último costo de reposición.
  El promedio ponderado con costo conocido lo calcula el cliente (riesgo aceptado);
  no se presenta como validado exhaustivamente por Rules.
- Apertura solo genera saldo técnico 0 con countPending=true y costos desconocidos;
  nunca copia stock local. Requiere futura vista previa y confirmación de incorporación.
- Ajustes y conteos concurrentes usan CAS estricto. Uno queda en conflicto; no se
  reenvía con revisión nueva automáticamente. El test resuelve explícitamente el ajuste
  restante y verifica resultado 5 desde saldo 10 y deltas -2/-3. Esto NO es aún una
  prueba de ventas simultáneas ni una política definitiva de conciliación de ventas.
- Sin migración IndexedDB, cola local ni UI en este bloque. El runtime actual no importa
  estos módulos; no se activan al iniciar sesión ni al vincular catálogo.

### Continuidad y puertas de activación

Nuevo orden definitivo: D1 diseño; D2 inventario; D3 eventos/configuración comercial;
D4 ventas/pagos/anulaciones; D5 offline/conciliación; D6 auditoría/estadísticas/validación.
La cola durable debe acompañar las operaciones locales antes de activar D2, aunque su
validación integral corresponda a D5. No publicar un stock central paralelo que las
ventas locales sigan descontando por separado.

Próximo trabajo D2: migración aditiva para outbox y réplica confirmada (con adaptador
de respaldos); incorporación explícita de saldos/pendientes; proyección de operaciones
locales sin doble descuento; integración transaccional con repositorios, coordinador y
estados visibles. Luego D3/D4 permiten habilitar el modo comercial coherente.
No incrementar versión ni reescribir históricos anticipadamente. D2 aún incompleto.

D4 debe conservar la venta local original y el resultado confirmado por separado si
cambia el stock al reconectar; costos históricos no se recalculan silenciosamente.
Evento/contexto obsoleto pasa a revisión, no cambia el evento de una venta ya cobrada.
UUID identifica ventas; resolver colisión del índice by-number antes de descargar otras.
El motor comercial cliente es aceptado; las ecuaciones de stock, la idempotencia,
la atomicidad y los permisos continúan siendo garantías exigibles por Rules.

### Pruebas ejecutadas en esta continuación

- 307/307 pruebas locales; lint y build (incluye TypeScript) correctos.
- `npm run test:firebase` no pudo arrancar: puerto 8080 ocupado. Se identificó proceso
  Java cloud-firestore-emulator-v1.22.0 con proyecto demo-matu-art en localhost, y se
  reutilizó solo para proyectos demo aislados. 20/20 pruebas Firestore aprobadas
  (catálogo, permisos, frontera anterior y cinco casos nuevos de inventario).
- Primera ejecución candidata falló por 1000 expresiones: la validación completa
  estaba duplicada en ambas escrituras. Se mantiene en recibo y se exige desde saldo
  un recibo nuevo coincidente en el mismo commit; pruebas repetidas pasan.
- Auth emulator no estaba disponible en esta repetición: su prueba NO se repitió.
  La ejecución anterior D1 de 16 casos sí incluyó Auth. No confundir ambos resultados.
- No se consultó ni modificó Firestore comercial real ni el IndexedDB del usuario.
  No se probaron teléfonos físicos, cola offline durable o ventas compartidas.
- No se publicó este candidato ni cambiaron reglas de producción. Build conserva
  advertencia preexistente de chunks >500 kB.

### Presupuesto de cuota preliminar (estimación, no medición)

Dos dispositivos y 40 ventas/hora durante 8 horas: 320 ventas. Un modelo futuro con
venta+recibo y un saldo/movimiento por producto requiere medir las líneas promedio,
reintentos y lecturas de Rules antes de fijar un límite. Para 3 productos por venta,
solo 5 documentos escritos por venta supondrían 1.600 escrituras; con movimientos
separados serían 2.560. No usar esta estimación como promesa: faltan gastos, catálogo,
recargas y reconexiones. D2 candidato escribe 2 documentos por operación individual.
Mantener listeners acotados a inventario activo (candidato limita 2.000 registros),
historial paginado, y detener al cerrar sesión. Si se agota cuota, conservar pendientes
locales, informar error y aplicar reintento con espera; nunca marcar confirmado ni borrar.

---

## Auditoría inicial conservada como historia (decisión de confianza sustituida arriba)

Fecha: 2026-11-10. **D1 auditado; protocolo completo aún no aprobado. D2–D5 no implementados.**
Firebase Spark exclusivamente. No se han desplegado reglas, enviado datos comerciales,
contratado servicios ni modificado IndexedDB en este bloque.

## Estado verificado en el código

- IndexedDB `clown-ufo-catalog` v11, 17 almacenes. `catalogSync` solo contiene
  catálogo: no hay outbox de ventas ni inventario confirmado remoto.
- `catalogRemote.ts` escucha products/categories/families/ips. Descarta snapshots
  de caché o con escrituras pendientes. Sus operaciones CAS/recibos son de catálogo.
  `catalogModel.ts`/`catalogLocal.ts` excluyen stock, costos y eventos intencionalmente.
- `SalesRepository.confirm` relee productos, evento, contexto de precios y promociones;
  valida pagos; guarda venta, pagos, movimientos, stock y contador en una transacción
  local de ocho almacenes. `by-operation` y fingerprint impiden repetir la operación.
- `voidSale` conserva pagos y snapshots; una compensación devuelve solo quantityDeducted.
  Ventas históricas importadas no admiten devolución de stock. La auditoría de anulación
  se guarda en la venta local; no existe anulación remota.
- `CatalogRepository` escribe productos/movimientos/costos en una transacción de siete
  almacenes. Ajustes validan revisión; conteos requieren revisión vigente; reposiciones
  calculan costo ponderado con BigInt. Reversión compensa el delta contra stock actual:
  solo restaura costos anteriores cuando coinciden revisión, stock y costos esperados;
  en otro caso conserva costos y marca provisional.
- `EventRepository` usa managedEvents+metadata; índice active-event único local,
  activación/reemplazo atómicos y contador event-price-revision. No hay autoridad remota.
- Promociones y combos calculados en JavaScript: hasta 12 promociones, 24 unidades
  elegibles, 128 asignaciones y 20.000 pasos de búsqueda. Pagos divididos y precio cero
  funcionan localmente. Packs físicos descuentan su propio stock.
- `firestore.catalog.rules` permite solo catálogo, reservas de nombres y recibos;
  no habilita ventas/inventario. `firestore.rules` es el archivo anterior de membresía
  y sigue referenciado por firebase.json: **no ejecutar firebase deploy sin seleccionar
  deliberadamente las reglas correctas**. Las pruebas de catálogo cargan su archivo
  explícitamente. No se verificaron las reglas publicadas de producción en este bloque.
- Respaldos validan conjunto de almacenes y pendientes. Agregar una outbox exige adaptar
  respaldo/restauración conjuntamente, nunca vaciar pendientes al restaurar o cerrar sesión.

## Bloqueo de seguridad y decisión de activación

No basta con añadir onSnapshot ni permitir a administradores escribir un objeto sale.
Un cliente autenticado puede cambiar su JS y enviar un total de $1 con pagos de $1 para
un carrito de $10.000. Comprobar pagos==total, roles, UUID, hash y revisiones no detecta
esa falsificación. Tampoco demuestra que un combo no reutilizó unidades o que se eligió
la mejor combinación. El cálculo local correcto no es validación de servidor.

Rules no ejecuta el motor TypeScript/BigInt ni sus bucles de optimización; tiene presupuesto
de expresiones y lecturas (10 por operación, 20 en transacciones, además del límite por
operación). No se ha construido una prueba verificable por Rules para este motor.
Esto es un bloqueo del protocolo actual, no una afirmación de que toda venta sea imposible
en Spark. **Mantener denegadas las escrituras comerciales completas hasta demostrar las
invariantes.** No activar D2 aisladamente mientras ventas locales descuentan por otro camino.

Opciones viables de arquitectura, aún NO autorizadas ni implementadas:

1. Spark estricto: operaciones simples acotadas verificadas por Rules y solicitudes
   complejas pendientes de aprobación humana. Un administrador sería autoridad explícita
   para excepciones, no un servidor que prueba el motor. Cambia la automatización solicitada;
   requiere aceptación. No quitar combos/promociones del POS local.
2. Motor completo automático: ejecución del motor existente en un servicio confiable que
   autentique Firebase, valide rol/contexto y confirme la transacción. No exige conceptualmente
   Functions, pero supone infraestructura externa, disponibilidad y evaluación de cuotas/costos.
   No se selecciona proveedor, despliega ni activa facturación en este bloque.

## Contrato propuesto (diseño, no colecciones creadas)

Todo bajo workspaces/{workspaceId}; UUID existente conserva identidad.

| Ruta | Autoridad / invariantes requeridas |
| --- | --- |
| inventory/{productId} | stock confirmado, countPending, revision, lastOperationId; ningún set aislado |
| costs/{productId} | promedio, último, estimado, condición; desconocido distinto de 0; acceso financiero separado |
| movements/{id}, costChanges/{id} | registros inmutables asociados a operación; compensaciones separadas |
| events/{id}, settings/activeEvent | estados y puntero único con revisión; venta conserva evento seleccionado |
| pricingContexts/{id} | versiones de precios por evento/promociones/combos y reglas; referencias históricas durables |
| sales/{saleId} | snapshot inmutable, UUID, operationId, origen, contexto, cantidades, precios, costos, descuentos, pagos y resultado confirmado |
| saleVoids/{saleId} | una anulación, motivo, actor, devolución elegida, movimientos compensatorios; no implica reembolso |
| commercialOperations/{operationId} | recibo inmutable de intención y resultado, actor, dispositivo, confirmado por servidor |
| commercialRequests/{operationId} | solo si se acepta revisión humana; nunca equivale a venta confirmada |

Mantener fechas comerciales originales separadas de confirmedAt servidor. El número
V-000001 es local: índice by-number único actual colisionaría entre dispositivos. Antes
de recibir ventas se necesita migración aditiva que preserve number como etiqueta histórica
y use UUID/dispositivo para identidad y presentación; no renumerar ventas antiguas.

Cada intención tiene schemaVersion, operationId, deviceId, actorUid, workspaceId,
occurredAt, kind, entityIds, expectedRevisions, contexto de precio/evento y payload.
Recibo usa el mismo operationId y comprueba identidad y contenido, no solo existencia.

## Transacciones y conciliación propuestas

1. Venta local y outbox durable se guardan juntas. Nunca inferir después la cola mediante
   diferencias de stock ni incorporar ventas antiguas automáticamente.
2. Online, releer recibo, inventario confirmado y contexto. Reintento idéntico devuelve
   recibo; reutilización de ID con otro contenido rechaza. Calcular y validar antes de commit.
3. Commit central único: venta, pagos históricos embebidos, movimientos, costos aplicables,
   stock, revisiones y recibo. No dividir una venta para eludir límites de Rules.
4. Guardar ACK y réplica confirmada en una transacción local. Crash después del commit
   remoto consulta recibo antes de reenviar. Listener nunca crea otra operación local.
5. Confirmado y proyección pendiente son capas distintas. No aplicar otra vez el descuento
   de una venta ya aplicada localmente. Con stock 10, ventas 2 y 3 resultan en 5.
   Descontado=min(vendido,max(stock,0)); diferencia=vendido-descontado. Negativo previo
   se conserva. Con stock insuficiente, preservar snapshot local y resultado central
   conciliado por separado; no sobrescribir evidencia original ni inventar unidades.
6. Conteo es absoluto y requiere revisión exacta: si hubo venta, pasa a revisión humana,
   nunca reemplaza un saldo más reciente. Ajustes/reposiciones son operaciones delta con
   revisión; cualquier rebase requiere política demostrada, en particular para costos.
7. Cambio de evento/precio/permisos durante offline requiere revisión; nunca reasociar
   venta ni cambiar pagos ya registrados. Eventos cerrados no se reabren por un reintento.
8. Anulación compara estado y operación original, devuelve solo descuento confirmado;
   conserva pagos, promociones, costos y diferencias. Segunda anulación no tiene efecto.

Estados durables futuros: pendiente, confirmado, conflicto, necesita revisión, error.
Sin conexión es transporte, no confirmación. Envío interrumpido vuelve a pendiente.
Logout conserva cola; cambiar cuenta no cambia actor ni autoriza operaciones ajenas.
Estadísticas distinguirán confirmado de local pendiente, sin sumar ambos como dos ventas.

## Incorporación inicial y listeners

Vista previa explícita de ventas/movimientos reales, prueba y desconocidos; no deducir
autenticidad por nombre. Elegir saldo de apertura confirmado con revisión y consentimiento,
sin reconstruir stock desde ventas importadas ni duplicar descuentos. Históricos importados
no producen stock. Nunca importar automáticamente datos antiguos al vincular catálogo.

Listeners propuestos: inventario autorizado y puntero activo; ventas por evento/período
con paginación y cursor persistente; deduplicación por operationId/UUID/revisión. Aplicar
página y cursor juntos; backfill para desconexiones largas. Detener listeners al cambiar
sesión/workspace. No descargar todo el historial en cada render. Medir lecturas reales:
Spark no es ilimitado. Transacciones Firestore fallan offline; outbox es necesaria.

## Puertas de validación pendientes

- D1: aprobar frontera de confianza, protocolo y límites medidos antes de habilitar D2.
- D2: emulador demuestra operación+movimiento+stock+costos inseparables, concurrencia,
  revisiones de conteo, reversión, permisos y payloads manipulados.
- D3: invariantes de todo el precio, promociones/combos, pagos, snapshots, evento y anulación;
  rechazar una venta fuera del protocolo sin confirmar parcialmente.
- D4: dos IndexedDB aisladas, reinicios en cada frontera de commit/ACK, cola durable,
  conflictos y revocación de permisos. Restauración no descarta cola.
- D5: prueba real autorizada en workspace de ensayo, dos dispositivos, recepción/estadísticas,
  desconexión/reconexión. No usar catálogo comercial como banco de pruebas silencioso.

## Fuentes oficiales consultadas

- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/firestore/manage-data/transactions

## Evidencias de este bloque

Se añade `tests/firebase/commercial-boundary.test.mjs` contra las reglas de catálogo:
rechazo de escrituras comerciales por roles y de batch mixto sin efecto parcial.
Estas pruebas demuestran denegación actual, **no seguridad de un protocolo de ventas
habilitado**. Resultados de ejecución se registran al terminar en README/PROJECT_CONTEXT.

Ejecutado: 303/303 pruebas locales, 16/16 emuladores (incluidas cinco nuevas), lint y
build/TypeScript correctos. Emuladores locales iniciados por CLI y apagados al terminar.
Warning preexistente de chunks >500 kB. Sin prueba real comercial ni cambios en producción.
