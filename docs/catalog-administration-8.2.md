# Administración local e importación masiva — 27-10-2026

Esta ampliación es local. El usuario confirmó mantener pendiente el despliegue cloud,
conservar Cloudflare Worker/D1 → Apps Script → Google Sheets y retomar su configuración
después. No se contrataron servicios, cambiaron secretos ni habilitó sincronización.

## Interfaz

- Inventario incorpora **+ Crear nuevo**: producto, categoría, familia, IP y promoción.
  Reutiliza ProductForm, QuickClassification y PromotionManager. Crear desde el menú
  no cambia los filtros ni la ruta; las acciones rápidas de los filtros sí seleccionan
  la clasificación recién creada. Los errores conservan el borrador.
- Organizar catálogo separa listados y formularios; muestra búsqueda, activos,
  archivados, orden, productos relacionados y acciones. Los accesos a Productos y
  Promociones reutilizan sus pantallas. No hay un segundo catálogo independiente.
- El estado de productos se selecciona con botones Activos/Archivados/Todos. El
  filtro nativo anterior no mostraba un fallo reproducible en el código; se reemplazó
  por un control explícito y se verificó el cambio sin recarga, archivo y reactivación.
- Las promociones tienen contadores y eliminación controlada. Nuevos nombres
  duplicados se rechazan normalizando mayúsculas/espacios. Los duplicados heredados
  no se borran ni se renombran automáticamente.

## Eliminación y reasignación

`entityAdministration.ts` revisa **todos los almacenes persistidos**, no solo el listado
visible. Una transacción readwrite abarca revisión y eliminación; otra abarca toda
la reasignación. La revisión inicial del diálogo no sustituye la revisión al confirmar.

La confirmación requiere escribir el nombre exacto y presenta tipo, consecuencias,
dependencias y alternativa de archivo. Solo se borra el registro elegido, sin cascadas.

Bloqueos: referencias UUID en productos/packs, clasificaciones, ventas (incluidas
anuladas y snapshots), movimientos, costos, eventos, promociones/combos, pagos,
gastos/auditorías e importaciones. Productos con stock no cero, costo conocido
(incluso cero) o excepciones de precios por evento tampoco se borran. La inspección
es deliberadamente conservadora: referencias anidadas o UUID en datos de origen
pueden bloquear una eliminación aunque no exista una relación comercial activa.

Categorías/familias históricas con el mismo UUID no se consideran relacionadas solo
por compartir su identificador raíz. Sus referencias reales sí bloquean. Una categoría
utilizada puede reasignarse a otra activa, con listado previo de productos incluidos
(también archivados). Cambios concurrentes invalidan la vista previa. Se conservan
familias, IPs, stock, costos, UUID e históricos; se incrementa la revisión del producto.
La categoría de origen no se elimina automáticamente ni se reescriben promociones.
Familias/IPs relacionadas ofrecen cancelar/archivar; no se desasocian en masa.

No hay protocolo de borrado cloud. Los metadatos no reconocidos, almacenes inesperados
o campos de sincronización/cloud en un registro bloquean el borrado. Antes de activar
sync habrá que integrar comprobación del servidor, outbox y tombstones; estas barreras
locales no se presentan como coordinación multidispositivo. No se borran registros
remotos ni se crean operaciones de sincronización ficticias.

## CSV, TSV y XLSX

El importador existente conserva vista previa, correspondencias, procedencia,
confirmación escrita y aplicación atómica. Añade XLSX con ExcelJS ya instalado y
plantillas vacías CSV (BOM UTF-8) y XLSX, descargables por tipo:

| Tipo | Columnas |
| --- | --- |
| Catálogo | Nombres, Categoria, Ips, Familias, Precios |
| Familias / IPs | Nombre |
| Ventas históricas | Evento, Fecha, Hora, Producto, Categoria, Cantidad, Precio_Total, Metodo_Pago |

`Categoria` es opcional en archivos antiguos; se conserva la revisión/inferencia
anterior. Las plantillas nuevas incluyen la columna explícita. Familias/IPs son
opcionales y admiten varios nombres separados por `|`. No se crean filas de ejemplo.
Los productos existentes no se sobrescriben; diferencias requieren correspondencia
revisada. Los nuevos quedan pendientes de conteo físico, sin inventar costos o stock.
Las ventas importadas no descuentan existencias ni generan movimientos.

Un archivo XLSX debe contener una sola hoja con datos. Fechas y horas deben ser
texto ISO, no fechas automáticas de Excel. Se rechazan fórmulas, enlaces, macros,
vínculos externos, formatos corruptos y hojas ambiguas. No se ejecutan expresiones.
Límites: 5 MB, 10.000 filas, 20 columnas, 25 MB descomprimidos y 2.000 entradas ZIP.
No se admite XLS, actualización masiva destructiva ni fusión de varias hojas.

Idempotencia por bytes originales y fila, incluido XLSX. Renombrar el mismo archivo
no duplica datos. Volver a guardarlo en Excel puede cambiar su hash: no hay deduplicación
semántica de ventas entre archivos modificados. Se conserva la revisión previa.
No se importaron archivos comerciales del usuario durante esta ampliación.

## Archivos

Nuevos: `entityAdministration.ts`, `CreateEntityMenu.tsx`, `DeleteEntityDialog.tsx`,
`ReassignCategoryDialog.tsx`, `importing/workbook.ts`, `entity-administration.test.ts`,
`import-workbook.test.ts` y este documento.

Modificados: Inventory, Promotions, ClassificationManager, QuickClassification y su
diálogo, ImportManager, App.css, importing/parse y plan, promotionRepository y la
fixture de nombres de la prueba de concurrencia de promociones (conserva el mismo
control de 12 activas). README y PROJECT_CONTEXT enlazan esta ampliación.

## Verificación real

- Build y lint correctos; **270 pruebas aprobadas**, ninguna fallida ni omitida.
- Doce pruebas nuevas: eliminación, confirmación, dependencia sobrevenida,
  conservación de históricos, reasignación y rollback inyectado, plantillas,
  rechazo de fórmulas/archivos ambiguos, importación XLSX, persistencia e idempotencia.
- Navegador aislado `127.0.0.1:5193`: creación rápida de categoría/familia/IP,
  producto sin costo, promoción desde Inventario, archivo/reactivación, filtros,
  vista previa y reasignación, bloqueo de categoría utilizada y confirmación de
  borrado habilitada solo al escribir el nombre. No se confirmó eliminación física
  desde el navegador; esa escritura se comprobó mediante pruebas automatizadas.
- Revisión de escritorio, 390×844 y 425×876; sin desbordamiento horizontal en las
  vistas medidas. Descarga real de plantilla XLSX y persistencia tras recargar.
- No prueba de teclado Android físico, red físicamente desconectada, importación
  completa mediante selector de archivos del navegador ni integración cloud real.
- IndexedDB permanece en **v10**, sin migraciones ni cambios a datos del usuario.
- Vite mantiene la advertencia de tamaño de ExcelJS, cargado bajo demanda. La lectura
  XLSX es local y limitada, pero no usa streaming; equipos lentos pueden tardar.

Evidencia local excluida de Git: `artifacts/admin-*`. Estos cambios no se publicaron
todavía en Pages; el servidor de vista previa anterior en 5192 puede seguir mostrando
la compilación anterior. El despliegue de Pages continúa siendo manual.
