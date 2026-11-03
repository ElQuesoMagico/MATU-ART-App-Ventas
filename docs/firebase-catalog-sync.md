# Hito C — catálogo Firestore (preparación local, 03-11-2026)

## Publicación y datos reales

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

`firestore.rules` conserva Hito B, que es el último archivo publicado por el usuario.
`firestore.catalog.rules` es el candidato de Hito C, probado en emulador, NO desplegado.
Miembros habilitados: lectura catálogo. Administrator/manager: escritura CAS acotada.
Seller: sin escritura catálogo. Ningún cliente escribe roles. Se deniegan borrados,
stock, costos y campos no permitidos; ventas/pagos/movimientos siguen denegados.
Registros requieren recibo atómico y reserva de nombre, identidad del actor y hora
servidor. Se probaron tres familias + tres IPs + categoría dentro del presupuesto
de accesos de Rules. El límite se valida antes de subir; nunca se recortan listas.

Antes de activar para usuarios:
1. Publicar conscientemente `firestore.catalog.rules` en Firestore Console (sin
   cambiar membresías ni activar reglas abiertas).
2. Verificar lecturas reales con ambas cuentas, rechazos de vendedor y workspace
   vacío. No crear fixtures en producción ni subir el catálogo sin confirmación.
3. Revisar limitaciones, completar validación móvil y recuperación de respaldos
   vinculados antes de considerar Hito C finalizado para operación general.
4. Configurar VITE_FIREBASE_CATALOG_ENABLED=true solo cuando corresponda, actualizar
   el workflow para incluirla y publicar el candidato revisado. Actualmente no se
   pasa esa variable en Actions y el frontend publicado solo tiene Authentication.
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
