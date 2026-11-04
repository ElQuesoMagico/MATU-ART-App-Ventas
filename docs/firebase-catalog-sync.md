# Hito C — catálogo Firestore (preparación local, 03-11-2026)

## Publicación y datos reales

Actualización: el usuario compartió una lectura real satisfactoria de Firestore,
con 0 registros en productos, categorías, familias e IPs. Queda verificado por
evidencia del usuario el acceso de lectura, no el flujo de escritura ni la
sincronización entre dispositivos. Se corrigió el aviso obsoleto de reglas
pendientes; la sincronización sigue desactivada por configuración.

El 03-11-2026 el usuario confirmó que publicó `firestore.catalog.rules`.
Esta confirmación no equivale todavía a una lectura real verificada del catálogo.
El modal local incluye «Comprobar lectura del catálogo»: renueva la sesión,
verifica membresía y lee las cuatro colecciones desde Firestore, mostrando sus
cantidades. No vincula IndexedDB, no inicia escuchas ni crea operaciones pendientes.
Puede utilizarse con VITE_FIREBASE_CATALOG_ENABLED desactivado. Si alguna lectura
falla o cambia la sesión, no muestra un resultado satisfactorio.
La configuración por defecto de firebase.json sigue apuntando a las reglas B;
no ejecutar un despliegue de reglas por defecto que sustituya las reglas C publicadas.

Comprobación posterior del diagnóstico: `npm run lint` y `npm run build` pasan;
`npm test` ejecutó 278 pruebas, todas aprobadas (registro local:
`artifacts/catalog-read-check-tests.log`). Build mantiene aviso de chunks grandes.
Servidor local 5193 responde HTTP 200. No había pestañas con sesión disponibles en
el navegador controlable: la lectura real queda pendiente de la acción del usuario.
Estas pruebas no equivalen a verificar las reglas recién publicadas en producción.

Authentication Hito B publicado con autorización expresa: commit `f88605d`,
GitHub Actions https://github.com/ElQuesoMagico/MATU-ART-App-Ventas/actions/runs/41715544450
(success). HTTP 200 verificado; entry `index-BJ7CYDgW.js`, Firebase chunk
`CloudConnection-BLZsBvqm.js`, dominio y workspace correctos en el bundle público.
Se corrigió la variable de repositorio VITE_FIREBASE_AUTH_DOMAIN, que faltaba.
La variable con nombre incorrecto se conservó sin uso. No contiene una contraseña.

El Hito C NO se ha publicado ni activado en producción. No se hicieron escrituras
de productos, clasificaciones, ventas o inventario en Firebase real. No se ejecutó
la carga de 77 productos ni importación histórica. Auth y membresías sí existen y
el usuario verificó admin/vendedor, recarga y cierre de sesión con datos locales.

## Modelo y protocolo

- Firestore: `workspaces/{workspace}/categories|families|ips|products/{UUID}`.
- Documento: payload estricto, revisión entera, operationId, actorUid y confirmedAt
  (timestamp de servidor). UUID estable; no se usan nombres como identidad.
- Payload compartido: nombre, descripción, creación original; clasificaciones con
  estado/orden; producto con categoría, familias/IPs, precio general, archivo,
  destacado y tipo product/pack. Se excluyen explícitamente stock, umbral, costos,
  imágenes, precios por evento, contenido documental de packs y datos transaccionales.
- Productos nuevos recibidos: stock técnico cero **pendiente de conteo**, costos
  desconocidos. Actualizaciones mezclan solo atributos permitidos sobre el producto
  vigente dentro de IndexedDB; conservan stock, costos, imagen y eventos.
- Cada escritura Firestore es una transacción CAS: lee revisión y recibo, reserva
  nombre, escribe registro + recibo inmutable en `catalogOperations/{operationId}`.
  Reintentos usan el mismo UUID, payload y revisión; ACK perdido no duplica.
- `catalogNames/{tipo_nombre-en-minúsculas}` impide mismo nombre exacto sin caso
  para UUID distintos. Cambiar nombre libera la reserva anterior en la transacción.
  No se aceptan `/` en nombres cloud. Normalización Unicode/espacios completa no
  es garantizada contra administradores maliciosos por Rules; comparación local
  usa NFKC y espacios normalizados. No se ofrece fusión automática de identidades.
- Conflictos CAS o nombres se mantienen visibles. Resolver requiere elegir local,
  cloud o exclusión, con confirmación. Usar local crea una nueva operación revisada;
  usar cloud conserva inventario/costos locales. Excluir no borra cloud ni local.

## Primera vinculación

Datos y respaldos → Conexión a la nube → Verificar acceso → Catálogo compartido.
Comparar consulta servidor y presenta registros nuevos, coincidentes, conflictos,
atributos local/cloud, selección de subidas/descargas y excluidos. Todo se excluye
por defecto. Descargar todo cloud es una selección, no una escritura inmediata.
La confirmación vuelve a leer cloud y comprueba la instantánea local en la misma
transacción que aplica descargas/estado. Cancelar no modifica nada.
Debe seleccionarse también la dependencia de clasificación necesaria para subir
un producto. UUID distinto con nombre coincidente exige renombrar o excluir;
no se reescriben UUID ni referencias históricas para hacer coincidir nombres.
Los excluidos quedan recordados. Los registros nuevos posteriores a vincular sí
entran en la reconciliación automática. Ausencia remota nunca significa borrado.

## IndexedDB y recuperación

Versión **11**: añade únicamente `catalogSync`; no modifica registros existentes.
Una fila `catalog` guarda workspace, UID propietario de la vinculación, deviceId,
baseline, operaciones pendientes, conflictos, exclusiones y última confirmación.
No guarda tokens ni contraseñas. Revisiones cloud son independientes de revision
local del producto (que también cambia por operaciones de inventario).

Cada cinco segundos se compara la proyección persistida del catálogo con baseline.
La cola se guarda antes de contactar Firestore; cambios locales aún no capturados
por el temporizador se reconstruyen al reabrir a partir de IndexedDB. Las pantallas
de negocio mantienen sus repositorios. La recepción y los cambios de baseline se
aplican atómicamente con el catálogo. Web Locks serializa ciclos entre pestañas;
CAS local detecta cambios durante una vista previa o ACK. La UI recarga al recibir
`catalog-cloud-updated`. Backoff acotado a 60 s ante error.

Firestore usa memoria, no persistencia offline del SDK. Cuatro listeners reciben
solo el catálogo del workspace tras vinculación; no se consulta todo Firestore en
cada render. Offline se conserva estado y se preparan pendientes. Si la aplicación
reabre offline con identidad de sesión, usa el permiso anterior solo para preparar
cola local; jamás autoriza escrituras remotas con ese dato. Al reconectar verifica
sesión/membresía y las Rules comprueban cada operación. Sin sesión, los datos locales
siguen disponibles y se reconciliarán cuando vuelva a entrar la cuenta vinculada.

La vinculación se limita a una cuenta/workspace por base local; entrar con otra
cuenta no adopta ni envía la cola anterior. Desvincular conserva datos y se bloquea
si hay pendientes, conflictos o cambios todavía no confirmados. Deben resolverse
o excluirse explícitamente antes. No se implementan borrados remotos; se archiva.

Respaldos formato 1 incluyen catalogSync y todos sus pendientes; adaptadores de
DB9/10 añaden colección vacía tras validar SHA. **Limitación deliberada:** restaurar
una base vinculada o un respaldo con vinculación se bloquea para no reactivar ni
perder operaciones sin revisión. Desvincular una base limpia permite restaurar
respaldos sin vinculación. Recuperar un respaldo vinculado en otro dispositivo
requiere un flujo específico de revisión todavía pendiente. No editar el JSON
ni recalcular su checksum manualmente para sortear esta protección.

## Seguridad y activación pendiente

`firestore.rules` conserva Hito B por compatibilidad histórica.
El usuario confirmó la publicación manual de `firestore.catalog.rules`; el 04-11
se verificó desde la UI local acceso administrador y lectura real de las cuatro
colecciones vacías. No se verificaron escrituras comerciales reales.
Miembros habilitados: lectura catálogo. Administrator/manager: escritura CAS acotada.
Seller: sin escritura catálogo. Ningún cliente escribe roles. Se deniegan borrados,
stock, costos y campos no permitidos; ventas/pagos/movimientos siguen denegados.
Registros requieren recibo atómico y reserva de nombre, identidad del actor y hora
servidor. Se probaron tres familias + tres IPs + categoría dentro del presupuesto
de accesos de Rules. El límite se valida antes de subir; nunca se recortan listas.

Antes de activar para usuarios:
1. Reglas C publicadas por el usuario; no sobrescribirlas con las reglas B.
2. Verificar lecturas reales con ambas cuentas, rechazos de vendedor y workspace
   vacío. No crear fixtures en producción ni subir el catálogo sin confirmación.
3. Revisar limitaciones, completar validación móvil y recuperación de respaldos
   vinculados antes de considerar Hito C finalizado para operación general.
4. La configuración local 5193 ya tiene VITE_FIREBASE_CATALOG_ENABLED=true.
   El workflow acepta la variable de repositorio, con false por defecto; no se ha
   activado esa variable remota ni publicado el candidato. Pages sigue en Hito B.
5. Primera carga: selección real explícita y confirmación del usuario.

## Pruebas y límites

- 278/278 pruebas locales de aplicación; lint y TypeScript correctos; build Pages
  correcto, sin publicación de C. Persisten avisos de chunks grandes.
- Emuladores Auth/Firestore: 10 casos, con múltiples aserciones; acceso roles,
  operaciones con máximo de referencias, dos contextos escritores, CAS concurrente,
  idempotencia, lectura vendedor, rechazo de stock/costos/borrado/escalamiento,
  archivo/reactivación, duplicados y referencias ausentes.
- Listener entre dos contextos de SDK probado. Detectó y corrigió un fallo inicial:
  se ignoraba caché sin pedir cambios de metadatos, por lo que colecciones sin
  cambios podían no confirmar lectura del servidor. Se usa includeMetadataChanges
  y se ignoran fromCache/hasPendingWrites; el listener pasó después de corregirlo.
- Dos bases fake-indexeddb independientes: primera carga seleccionada, descarga,
  edición, conservación stock/costos, conflicto, cierre/reapertura de conexiones,
  respuesta de red perdida/reintento, exclusiones, proyección estricta y migración.
- UI real localhost5194, Firebase **emulado**: login, verificar, comparar, exclusión
  inicial por defecto, selección descarga, confirmación y estado vinculado sin
  pendientes. Datos QA creados solo en `demo-matu-art-ui`, nunca `matu-art`.
- Pendiente: dos dispositivos físicos; navegador real en 390/425 px; corte de red
  físico, sesiones expiradas por tiempo, escritor/lector reales de catálogo.
- Límite actual: 2.000 registros por tipo y máximo 3 familias/3 IPs por producto.
  Se rechaza exceso explícitamente; no paginación escalable aún. Cuotas Spark no
  ilimitadas: una primera conexión de listeners lee el catálogo seleccionado.
- No sincronización de ventas, inventario, costos, imágenes ni promociones.

Módulos: `catalogModel`, `catalogLocal`, `catalogRemote`, `catalogRuntime`,
`CatalogSyncPanel`, `CatalogSyncBootstrap`; integración en client Firebase, App y
CatalogProvider; migración y adaptadores de respaldo; pruebas catálogo y Rules.

## Continuación 04-11-2026 — entrega local

- Comparación con búsqueda y filtro de entidad; conteos locales/remotos separados.
- Acción explícita para incluir dependencias de los productos seleccionados sin
  seleccionar otros productos ni familias de prueba. Los filtros conservan selecciones.
- Detalle de versiones locales/remotas en conflictos; protección síncrona de doble clic.
- 279 pruebas de aplicación y 10 casos de Emulator Suite aprobados en esta ejecución.
  Registros: artifacts/catalog-link-tests.log, catalog-link-emulators.log y
  catalog-link-build.log. Lint y build correctos; aviso habitual de chunks grandes.
- UI real 5193: admin verificado, 2 categorías/1 familia/1 IP/1 producto QA locales,
  0 registros remotos. Cinco excluidos, cero subidas/descargas, búsqueda y cancelación.
  No se confirmó vinculación ni se escribió en Firestore. No se usaron dos dispositivos
  reales ni se verificaron resoluciones móviles específicas en esta ejecución.

Preparación de los datos reales:
1. Crear respaldo JSON local antes de importar.
2. Inventario → Importación masiva · Administración. Seleccionar únicamente catálogo
   maestro, familias e IPs de docs/import-sources; dejar ventas históricas sin archivo.
3. Generar y revisar vista previa; corregir clasificaciones pendientes y confirmar
   la importación local solo cuando corresponda. No se modifican los archivos fuente.
4. Conexión a la nube → Verificar acceso → Vinculación inicial · Comparar.
5. Seleccionar los registros comerciales para subir; mantener QA excluidos. Usar
   Incluir clasificaciones de productos seleccionados y revisar todos los conteos.
6. Solo el usuario confirma la vinculación/carga. En el segundo dispositivo, comparar
   y seleccionar descarga cloud, revisar y confirmar; no importar otra copia con UUID nuevos.

Atomicidad: cada registro cloud, revisión, recibo y reserva de nombre se confirman en
una transacción Firestore. Las clasificaciones se confirman antes de productos;
Rules valida referencias. La primera carga completa NO es una sola transacción:
si se interrumpe, puede haber clasificaciones confirmadas y productos pendientes,
que se reintentan con el mismo operationId. Las aplicaciones locales de catálogos
recibidos y el estado de sincronización sí comparten una transacción IndexedDB.
No se promete rollback global de una carga de múltiples entidades.

## Primera carga real — 04-11-2026

Con confirmación explícita del usuario se ejecutaron 129 subidas desde localhost5193:
77 productos, 7 categorías, 5 familias, 40 IPs. Cinco registros QA excluidos.
Cola final 0 pendientes y 0 conflictos; confirmación 00:39:53 America/Santiago.
Nueva lectura real de Firestore a las 00:40:04 confirmó los cuatro conteos.
No se escribieron datos transaccionales ni inventario/costos. La vinculación quedó
activa. Esto reemplaza el estado anterior «sin escrituras reales» para la primera
carga, pero no demuestra todavía sincronización real entre dos dispositivos.
