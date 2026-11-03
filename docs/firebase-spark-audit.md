# Firebase Spark — Hito A: auditoría y diseño

Fecha: 03-11-2026 (America/Santiago). **Diseño, no integración implementada.**
Decisión vigente: GitHub Pages + Firebase Auth (correo/contraseña) + Firestore
Standard + IndexedDB. Spark exclusivamente. No Blaze, tarjeta, Functions, Cloud Run,
Storage de Firebase ni servicios pagos. Exportaciones CSV/XLSX siguen disponibles.
Cloudflare/D1/Apps Script/Sheets dejan de ser dependencias objetivo; se conserva su
código y recursos, sin desplegar, borrar ni revocar automáticamente nada.

## 1. Estado comprobado

La URL https://elquesomagico.github.io/MATU-ART-App-Ventas/ respondió HTTP 200 el
03-11-2026, título MATU ART y bundle `/MATU-ART-App-Ventas/assets/index-Cb6KOVTQ.js`.
Esto verifica disponibilidad HTTP, no instalación en Android ni prueba visual nueva.
No se ha publicado ningún cambio en este hito.

| Área inspeccionada | Evidencia y límite |
|---|---|
| Persistencia | `catalogDatabase.ts`: `clown-ufo-catalog`, versión **10**, 16 almacenes; último añadido `importRecords`. No Firebase SDK ni outbox actual. |
| Almacenes | products, categories, families, ips, movements, costChanges, sales, payments, metadata, events, managedEvents, promotions, expenses, expenseCategories, expenseChanges, importRecords. |
| Catálogo | `catalogRepository`, `classificationRepository`, `entityAdministration`: revisiones, archivo/reactivación, eliminación guardada y reasignación atómica. No replicación remota. |
| UI reciente | `CreateEntityMenu`, Inventario y clasificación conservan creación de cinco entidades, filtros de estado y administración. No rehacer. |
| Importación | `importing/parse`, plan, apply, reviewed, workbook: CSV/TSV/XLSX, plantillas, vista previa y procedencia/idempotencia local. `applyImport` no llama a servicios externos. |
| POS | `salesRepository.confirm`: relectura de precio/evento/costo/promos, pago exacto, venta/pagos/movimientos/stock/contador en una transacción idb. Esto protege frente a carreras locales, NO frente a JavaScript malicioso. |
| Anulaciones | Compensación por unidades realmente descontadas; conserva pagos/snapshots. Solo atomicidad local. |
| Promos/combos | Motor puro con hasta 12 promos activas, 24 unidades elegibles, 128 colocaciones y 20.000 pasos de búsqueda. BigInt, reparto proporcional y desempates. No trasladable directamente a Rules. |
| Datos/UI | CatalogProvider carga snapshots locales y BroadcastChannel refresca pestañas del mismo origen. `salesRepository.snapshot()` usa getAll: no copiarlo como consulta remota global. |
| Respaldos | Formato 1, DB9/10, SHA-256, imágenes Blob/base64, 128 MiB, validación de referencias, preview token y reemplazo/validación en una sola transacción. SHA detecta corrupción, no autoría contra un atacante. |
| Bloqueos de integración | `assertStoreSet` exige almacenes exactos y `assertNoPendingOperations` rechaza metadata desconocida. Backups/importador/borrado deben adaptarse junto a cualquier outbox futura. |
| Roles | Roles y controles servidor existen en backend D1; NO son control de acceso del POS local ni reglas Firebase. |
| Legacy cloud | Worker preparado, no desplegado; D1 real con dos migraciones; GAS publicado solo lectura y rechazo anónimo verificado. Nunca se verificó petición autenticada a Sheets. Código de catálogo v2 no conectado a endpoints y GAS v2 inexistente. |
| Git | Se recibieron cambios locales de preparación Worker sin commit. Se conservan; no confundirlos con una nueva modificación de este hito ni publicarlos. Subdominio eqmm comunicado por usuario, ya irrelevante para el objetivo Firebase. |

El contrato cloud anterior proyecta productos sin stock/costo/imágenes/excepciones
de evento/contenido completo de packs. No reutilizarlo como sincronización total.
Los tres productos históricos pendientes siguen marcados `pending` en reviewed.ts.
Conservar ambos packs y archivar Grumpy Cat es una decisión del usuario, NO una
importación completada. Faltan datos maestros verificables: no inventarlos.

## 2. Dictamen de viabilidad y frontera de confianza

**Apto para preparar B (Auth) y C (catálogo administrativo) con pruebas de Rules.
NO aprobado D: ventas completas automáticas con el motor actual.** No se promete
que toda la funcionalidad de dos dispositivos esté resuelta solo por elegir Spark.

El atacante considerado tiene cuenta de vendedor válida, modifica JS/SDK/REST,
repite UUID, cambia actor/evento, precios, cantidades, promociones, pagos y stock.
TLS, App Check, esconder botones o calcular un hash en React NO validan la lógica
comercial; un cliente alterado puede generar también ese hash. Rules son la barrera.
Ni siquiera un backend verifica que se recibió efectivo: solo consistencia contable.

| Operación/invariante | Diseño de protección / decisión |
|---|---|
| Miembro activo/rol/evento | `request.auth.uid`, documento de membresía y acceso explícito al evento; denegar por defecto. No roles suministrados por React. |
| Escalamiento | Ningún cliente puede escribir membresías/roles en B. Primer admin y cambios privilegiados por consola del propietario. Campos de perfil separados. |
| Catálogo | Solo admin (encargado según permisos explícitos posteriores); allowlist de campos, tipos, rangos, UUID=ruta, createdAt inmutable, revision+1 y request.time. Vendedor solo lectura. |
| Referencias múltiples | Rules deben comprobar las referencias, no solo su forma. Para listas variables exigir un límite pequeño y comprobaciones explícitas o modelo de asociaciones; medir accesos antes de fijar límites. El límite legacy de 100 IDs no es aceptable sin esa prueba. |
| Nombres únicos | Reservas por tipo+clave normalizada en transacción, con liberación/archivo controlado. Rules no reproducen NFKC y toda la normalización local: escritura restringida a administradores de confianza; no anunciar unicidad Unicode resistente a administradores maliciosos. |
| Venta simple acotada | Candidata: lista fija/acotada, precio de catálogo/excepción consultado por Rules, pagos cash/transfer/debit tipados y suma explícita, total y snapshots verificados; lectura de revisiones + getAfter para venta/operación/stock/movimientos. Todavía no implementada ni probada. |
| Promos/combos completos | No aceptar cálculo cliente como autoridad. Rules no ejecutan bucles/recursión/optimizador y tienen presupuesto limitado. Escritura confirmada directa denegada hasta un protocolo demostrable. |
| Descuentos libres | No permitir a un vendedor cambiar el precio final arbitrariamente. Política de descuentos autorizada/revisión, separada de la regla local existente. |
| Inventario | Nadie actualiza stock suelto. Cada cambio requiere operación y movimiento correspondiente, cantidad anterior/posterior y revisión coherentes en el mismo commit. Conteos/reposiciones/costos son protocolos independientes. |
| Histórico | Inmutable, sin delete; anulación como documento separado y compensación vinculada/idempotente. No reemplazar snapshot histórico con el catálogo vigente. |
| Roles/offline | Revocación se verifica en cada escritura central. No revoca archivos locales ya descargados: seguridad del perfil/dispositivo sigue siendo necesaria. |

Firestore permite 10 accesos de documentos por operación y 20 por transacción/batch
en Rules, y 1 MiB por documento. getAfter impone relaciones entre escrituras, pero no
recalcula el motor JS. No dividir una venta atómica en varios commits para eludir
límites. Tampoco basta comprobar solamente que su total sea >=0 o pagos==total.

### Alternativa compatible con Spark, pendiente de aceptación y prueba

1. Conservar POS local completo, claramente **solo local** durante B/C.
2. En modo compartido, vendedores crean solicitudes inmutables no confirmadas;
   no alteran stock central con promociones/combos no verificables.
3. Administrador revisa excepciones explícitamente antes de confirmar. Esto cambia
   el modelo: el administrador es autoridad comercial humana, no un backend que
   garantiza los cálculos. Su navegador sigue siendo manipulable.
4. Opcional para D: un subconjunto simple con un máximo pequeño de líneas,
   sin combos/promos no verificables, demostrable en Emulator antes de habilitar.
   O precios/ofertas finitas preautorizadas por administrador con comprobaciones
   acotadas. No equivale al motor completo ni se activa silenciosamente.

No se impone esta reducción al producto existente en A. Si se exige motor completo
automático resistente a clientes vendedores alterados, D queda bloqueado bajo
estas restricciones hasta diseñar y demostrar otra solución; no bajar seguridad.

## 3. Modelo Firestore propuesto (no creado)

Firestore Standard, base `(default)`, un workspace por emprendimiento. Todos los
documentos comerciales bajo `workspaces/{workspaceId}` y UUID históricos intactos.
Firebase UID es una identidad de autenticación distinta del UUID comercial.

| Ruta relativa | Contenido y acceso previsto |
|---|---|
| members/{uid} | role, enabled, createdAt; creado/cambiado por consola en B. Usuario lee propio; admin consulta miembros. Sin claves/passwords. |
| events/{eventId}/members/{uid} | autorización por evento, separada de la propiedad del evento. Console/admin autorizado; no autoconcesión. |
| categories, families, ips /{id} | nombre, descripción, orden, archivo, esquema/revisión/actor/fechas servidor. |
| products/{id} | catálogo: precio general, IDs, flags, kind/packContents, umbral. Excluye stock y costos privados. Imágenes inicialmente locales. |
| inventory/{productId} | stock, countPending, revision, lastOperationId; únicamente transacciones verificadas. No reemplazar al descargar catálogo. |
| costs/{productId} | promedio/último/estimado/condición, acceso restringido. null=desconocido, cero conocido. Documento separado: Rules no oculta campos de un documento leído. |
| costChanges/{id}, movements/{id} | ledger append-only y referencias a operación/producto/venta/reversión. |
| events/{id}, legacyEvents/{id} | managedEvents y legacy separados; no inventar asociación por nombre. |
| settings/activeEvent | eventId o null, revisión, precio-contexto; transacción coordinada con estados de eventos. Un único puntero central. |
| products/{id}/eventPrices/{eventId} | precio entero incluso 0, revisión; administración exclusivamente desde producto, UUID evento. |
| promotions/{id} | descuentos/quantity/combos según tipos actuales; sin duplicar combos en otra colección. Lectura del contexto versionado. |
| saleRequests/{saleId} | actor, dispositivo, operación, evento/contexto, intención y snapshot declarado NO confiable, estado de revisión separado. Sin efecto central de stock. |
| sales/{saleId} | snapshot final inmutable: líneas, pagos (máximo 3 métodos), descuentos/promos/combos, costos, cantidades descontadas y diferencias, totales, origen, revisión de política. Detalles embebidos acotados para comprobar sumas; no duplicar pagos en colecciones mutables. |
| saleVoids/{saleId} | una compensación por venta; auditoría y elección de stock; conserva pagos y no presume reembolso monetario. |
| operations/{operationId} | actor/dispositivo/tipo/entityIds/baseRevisions/resultado/fecha confirmada. Creación atómica con efecto comercial, inmutable. No ACK antes del servidor. |
| expenses/{id}, expenseCategories/{id}, expenseChanges/{id} | acceso financiero restringido, auditoría; global sin reparto ficticio a eventos. |
| imports/{batchId}, importRecords/{id} | fuente/hash/fila/coincidencia/entidades; sin originales privados públicos. Manifiesto revisado y progreso reanudable por lote. |
| audit/{id}, nameReservations/{id} | auditoría append-only y unicidad administrativa; mismo commit que cambio cuando corresponda. |

Campos comunes: schemaVersion, revision entera, createdAt/updatedAt del servidor,
createdBy/updatedBy, sourceDeviceId y lastOperationId. Fechas originales comerciales
se conservan aparte como occurredAt/clientCreatedAt, nunca sustituyen request.time.
Campos opcionales se omiten o son null según contrato; no enviar undefined a SDK.
Importes enteros CLP con límites compatibles con los cálculos actuales.
Un número visible V-000001 local no identifica una venta global: conservarlo como
localNumber con deviceId, identificar por UUID y usar etiqueta visible no ambigua.

### Consultas e índices previstos

- Catálogo pequeño (55–100 productos): carga inicial paginada (100) por updatedAt
  y documentId; revisiones/cursor persistente. Incremental por cursor con solape y
  deduplicación, aplicar página y cursor juntos en IDB. Cambios durante la descarga
  se recogen con listener/captura posterior sin saltos.
- Listener activo para catálogo/inventory y un settings/activeEvent, promociones
  vigentes y eventos autorizados acotados. Desuscribir al salir de sesión/workspace.
  No listener global de todo historial. Sin polling constante.
- Historial: eventId+confirmedAt desc, actorId+confirmedAt desc, fecha desc con
  documentId como desempate, páginas de 50; índices compuestos previstos.
- Movimientos: productId+createdAt desc; gastos eventId+date desc; solicitudes
  actorId+createdAt desc / estado de revisión+createdAt; imports por batchId.
- Combinar filtros categoría/familias/IPs del catálogo en memoria sobre la réplica
  pequeña: no generar combinaciones ilimitadas de índices array-contains.
- Eximir de índices blobs/snapshots, líneas/pagos, textos extensos y payloads que no
  se consultan. Índices consumen almacenamiento. Rules no filtran resultados:
  las consultas deben restringirse al workspace/evento permitido.
- Estadísticas paginan el evento solicitado y reutilizan los históricos locales
  confirmados. No descargar todas las ventas al abrir Home ni crear agregados
  escribibles por vendedores con totales sin validar.
- Sin borrado remoto físico en primera versión: archivo/tombstone durable para
  que un dispositivo antiguo no resucite entidades. Hard delete local bloqueado
  para entidades vinculadas, preservando administración local no vinculada.

## 4. Auth y administración (B, pendiente)

Firebase email/password sustituye el login D1; no migrar hashes scrypt a la Web.
Solo variables públicas VITE_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, APP_ID,
MESSAGING_SENDER_ID y VITE_FIREBASE_WORKSPACE_ID. No service-account JSON, Admin SDK
ni contraseña en bundle/repositorio. Permitir `elquesomagico.github.io` en Auth
(dominio, no ruta); mantener base Vite /MATU-ART-App-Ventas/ y workflow manual.

Sin UI de registro público. Eso NO deshabilita necesariamente la API de creación
de Firebase Auth: una cuenta creada por un cliente alterado no tendrá membresía
y las reglas deben denegarle todo dato. No bootstrap de admin desde el navegador.
Propietario crea la cuenta email/password en consola Auth y documento members/UID
en consola Firestore con role=administrator, enabled=true. Probar que ninguna
cuenta puede autoconcederse ese documento. Mantener deny-all hasta reglas probadas.
Crear/deshabilitar/eliminar cuentas Auth requiere consola/Admin privilegiado:
no simular esas acciones desde Web SDK. Administración de roles en aplicación solo
si un protocolo posterior valida quién puede otorgarlos y audita el cambio.

Persistencia Auth propuesta explícita: sesión gestionada por SDK (session), nunca
copiar tokens a nuestro IDB/outbox/backups. No es la antigua cookie HttpOnly:
tokens Web SDK son accesibles a JS, requieren protección XSS y no scripts ajenos.
Reapertura puede requerir login, pero datos locales siguen disponibles. Cambiar UID
no permite reenviar operaciones de otro actor; logout no borra ventas pendientes.
Validar esta elección en B antes de ofrecer recordar sesión persistente.

## 5. Autoridad y sincronización (C/E, pendientes)

Firestore manda sobre registros CONFIRMADOS. IDB mantiene réplica confirmada y
operaciones locales durables por separado. No sobrescribir el stock confirmado
con el stock calculado offline, ni enviar snapshot local completo como merge.
Firestore usará caché de memoria, sin persistencia automática de escrituras en
disco; un único coordinador controla outbox. La existencia de caché SDK no es ACK.

Futura migración IDB aditiva (versión a decidir al implementar, hoy sigue v10):
syncOutbox, syncState/baseSnapshots, syncConflicts, devices; metadata actual solo
admite números y no sirve como outbox. Operación y cambio local en MISMA transacción.
Campos: UUID estable operationId/saleId/deviceId, actorUid/workspaceId, tipo, versión
de esquema, baseRevision por entidad, payload canónico, estado, reintentos, ACK.
Estados: pendiente, sincronizando, confirmado, conflicto, error. Sin conexión es
estado de transporte independiente; sincronizando interrumpido vuelve a pendiente.
Lease/coordinación de pestañas y mismo operationId en reintentos; no recrear IDs.

Publicar catálogo: comparar contra base confirmada -> preview campos/revisiones ->
confirmación explícita -> transacción CAS de entidad, auditoría y operación.
Si operación ya existe, comprobar identidad y payload/resultados; hash generado
por cliente no es prueba de integridad del servidor. Colisión distinta se rechaza.
ACK remoto primero, después reconciliación IDB; crash intermedio consulta operación
ya confirmada y no repite efecto. Conflicto nunca last-write-wins silencioso.
Recibir campos de catálogo no modifica stock/costos/imagen; los productos nuevos
quedan pendientes de conteo hasta que inventario central sea incorporado mediante
un protocolo aprobado. Campos excluidos deben verse como no sincronizados.
Selección inicial workspace/propietario y datos QA/reales explícita; no autovincular
una base con ventas de otro usuario/workspace. No enviar nada solo por hacer login.

## 6. Concurrencia y offline: requisitos antes de D/E

Transacción online relee inventario central/revisiones/contexto, valida permiso y
calcula descuento efectivo: min(cantidad,max(stock,0)); siguiente stock=anterior-
descontado; diferencia=cantidad-descontado. Negativo legacy se conserva, no se agrava.
Con stock10 y A2/B3 ->5, independientemente del orden; con stock1 y A1/B1 ->0,
la segunda tiene diferencia1 real. Si cambia precio/evento durante reintento,
requiere revisión; no autocobrar otro importe. Rules deben validar toda la ecuación.

No confirmar una venta central sin venta+pagos+movimientos+stock+idempotencia atómicos.
No usar increment a ciegas (puede producir negativo), ni stock absoluto basado en
lectura local. Límites de líneas/lecturas se prueban antes de habilitar; si excedidos,
error claro, no dividir la venta ni confirmar parcial. Anulación exige rol, motivo,
única operación y devuelve únicamente deducted histórico.

Offline guarda intención y condiciones/pagos inmutables, estado pendiente cloud,
inventario proyectado separado del confirmado. Registro local no equivale a ACK.
En reconexión, precio/evento/permisos/stock se revalidan; conflicto preserva la venta
y su importe cobrado, requiere revisión sin inventar nuevos pagos/precios. Históricas
importadas se incorporan sin movimiento de stock; no descontar nuevamente ventas
locales cuyos movimientos ya existen. Recibir ACK aplica snapshot confirmado y
retira proyección por operationId, no vuelve a ejecutar SalesRepository.confirm.
No reetiquetar automáticamente todas las ventas existentes como pendientes cloud.

## 7. Spark y presupuesto (estimaciones, no medición productiva)

Fuentes oficiales consultadas 03-11-2026; cuotas compartidas por proyecto:
Firestore Standard gratis: 1 GiB, 50.000 lecturas/día, 20.000 escrituras/día,
20.000 borrados/día, 10 GiB salida/mes, una base con cuota gratuita.
No TTL/PITR/backups gestionados/restores gestionados sin facturación.
Email/password disponible sin SMS; límites antiabuso de Auth siguen aplicando,
incluyendo alta de cuentas por IP y envío de correos. Si se habilita Identity
Platform, revisar además sus límites específicos (no asumirlos iguales a Auth base).
Dos cuentas no justifican activar Identity Platform, SMS ni servicios extra.
Cloud Storage requiere Blaze: imágenes siguen locales/respaldos explícitos,
sin publicar imágenes privadas en GitHub ni convertir Firestore en bucket base64.
Esto limita la réplica de imágenes entre dispositivos, debe mostrarse al usuario.

Ejemplo de capacidad para un protocolo FUTURO aprobado: 8 horas, 40 ventas/hora
totales=320 ventas; 3 líneas distintas/venta; 2 dispositivos. Si 40/hora por cada
dispositivo, duplicar componente de ventas (640). No es prueba de seguridad.

- Escrituras por venta hipotética: 1 venta con pagos/líneas +3 stock +3 movimientos
  +1 operation +1 audit =9; 2.880/día o 5.760. Solicitud/revisión previa agrega
  escrituras; reposiciones, cambios de costo y anulaciones se cuentan aparte.
- Lecturas orientativas: 10–20 por venta (datos/reglas/reintentos) =3.200–6.400;
  listeners 3 productos*2 dispositivos*320=1.920; si consumen venta confirmada
  ambos, +640. Catálogo inicial hasta200 productos+clasificaciones, eventos/promos.
  Con ~1.000 lecturas auxiliares: ~6.760–9.960/día sin reconexiones intensas.
  El doble de ventas ~12.520–18.920. No garantiza caber en cuota bajo abuso/reintentos.
- Reglas get/exists pueden contar incluso al denegar. Listener cobra cambios y
  reconsultas; con caché persistente deshabilitada cada reconexión cuenta consulta
  nueva. Evitar listeners abiertos en pantallas no activas y consultas de historial
  sin límite. Agregar margen para reconexiones y supervisar Usage.
- Si payload medio de lectura=4 KiB, 10.000 lecturas≈39 MiB/día; 30 días≈1,15 GiB,
  sin contar documentos mayores/indexación/otros usos. Medir bytes reales.
- A 15 KiB persistidos por venta+ledger: 320≈4,7 MiB/día antes de índices, ~141 MiB
  por 30 días. 1 GiB no es almacenamiento infinito: alertas/retención revisada,
  nunca eliminar históricos automáticamente para liberar cuota.

resource-exhausted/unavailable conserva outbox y muestra error; backoff con jitter,
sin bucle de reintentos. Si la cuota se agota, no prometer ACK ni activar Blaze.

## 8. Importación y respaldos

No subir respaldo QA ni datos reales en A. Mantener fuentes originales excluidas de
Git. Manifest de importación: workspace, origen, hash/fila, UUID, revisión prevista,
coincidencias explícitas, validación de referencias, exclusión QA y confirmación.
Lotes acotados idempotentes/reanudables con resultado detallado; no prometer atomicidad
global entre cientos de documentos. Stage no visible como catálogo activo hasta
validación/publicación final por protocolo; no activar productos parcialmente cargados.

Backups actuales no pueden incluir una outbox nueva: schema y assertStoreSet deben
cambiar juntos ANTES de activarla. Nuevo formato/adaptador conserva DB9/10 y datos
pendientes, ACK/revisiones/procedencia/workspace; nunca tokens Auth/contraseñas.
Restore con pendientes no reconciliados bloqueado, sin borrar ni sobrescribir cloud.
Restaurar copia local antigua NO crea derecho a re-publicar ventas: consultar UUID
de operaciones y revisar conflictos. SHA-256 no otorga permisos de servidor.
Export admin cloud necesita lectura paginada y consistencia por revisiones/ventana
de mantenimiento: no llamar completo a un export intercalado con cambios sin validar.
Cuenta Auth, hashes, reglas/índices y membresías requieren procedimientos separados
de propietario/consola; backup comercial cliente no es backup de Firebase Auth.

## 9. Hitos y verificación

A: auditoría/diseño y documentación solamente. Sin Rules ejecutables ni SDK instalado.
B: emulator Auth/Rules deny-by-default, bootstrap consola, login/session/logout y
rejection de sin miembro/rol/evento ajeno/escalamiento. Reglas nunca test mode.
C: catálogo + IDB/outbox/backups coordinados; conflict/retry/archivo/eliminación,
imports y test de reinicio entre ACK y commit local, antes de producción.
D: NO GO para motor completo; subconjunto/revisión solo tras decisión explícita y
pruebas adversariales de todas las invariantes. Ningún bypass para alcanzar objetivo.
E: offline/permisos revocados/precios cambiados/cuota/restauración pendiente.
F: QA aislado, dos dispositivos reales, revisión datos de importación, confirmación
y conexión real; no convertir éxito emulador en éxito producción.

Pruebas futuras obligatorias de Rules: vendedor altera precio/stock/total/pago/costo,
omite movimiento, duplica ACK, cambia actor/workspace/evento, borra histórico,
crea admin; cada ataque debe fallar. También transacciones concurrentes 10-2-3 y
última unidad, rollback, anulación duplicada, promoción fuera de versión; límites
de reglas en peor caso, no solo caminos felices. Sin simulaciones que se presenten
como ejecución real de reglas: utilizar @firebase/rules-unit-testing + emuladores.

No se ejecutaron emuladores ni pruebas Firebase reales en A porque no hay integración.
No se inició sesión, creó proyecto, habilitó facturación, revocó Apps Script ni borró D1.
La actualización no cambia UI, logo, POS, datos locales o publicación existente.

## 10. Primer paso externo tras revisar este dictamen

Crear proyecto Firebase desde console.firebase.google.com, nombre MATU ART, Spark,
sin Google Analytics ni facturación; no App Hosting/Storage/Functions. Anotar ID
público. Luego guiar individualmente registro Web, email/password, Firestore
Standard `(default)` con ubicación decidida antes (no trivial de cambiar), reglas
cerradas, dominios autorizados, variables públicas y emuladores. No empezar B
hasta reconocer las restricciones de D; no prometer el POS completo seguro.

## Fuentes oficiales

- https://firebase.google.com/pricing
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/firestore/security/rules-query
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/pricing
- https://firebase.google.com/docs/auth/limits
- https://firebase.google.com/docs/auth/admin/manage-users
- https://firebase.google.com/docs/auth/web/auth-state-persistence
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/rules/unit-tests

## Resultado ejecutado del Hito A — 03-11-2026

- npm run lint: correcto.
- npm test: 272 aprobadas, 0 fallidas, 0 omitidas.
- MATU_BASE_PATH=/MATU-ART-App-Ventas/ npm run build:pages: correcto,
  TypeScript + Vite + verificación de 20 recursos/rutas/manifiesto/caché.
- Advertencia existente: ExcelJS lazy chunk supera 500 kB.
- git diff --check: correcto; avisos de normalización LF/CRLF en Windows.
- Logs locales ignorados por Git: artifacts/firebase-a-tests.log y firebase-a-pages.log.
- Cambios de este hito: este documento, README, PROJECT_CONTEXT y avisos históricos
  en cloud-8.1, cloud-8.2, cloud-worker-hosting. Sin cambios a código funcional.
- No migración IDB, reglas Firebase desplegadas, SDK, emuladores ni conexión Firebase.
- No pruebas nuevas de UI/móvil/Android/instalación/offline físico en este hito.
- Hito A (documentación/auditoría) terminado con bloqueo explícito de D; etapa 8.2
  no completada. No se inició B ni se publicó nada.
