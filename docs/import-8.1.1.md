# Importación inicial controlada — Etapa 8.1.1

Estado al 20 de octubre de 2026: implementación local y pruebas automatizadas;
**no se ejecutó la importación definitiva en la base del usuario**.

## Entradas y resultado real revisado

El catálogo completo facilitado en el chat está transcrito en
`docs/import-sources/catalogo-maestro.tsv`; familias e IPs en archivos CSV vecinos.
No se cargan automáticamente. El archivo original de ventas permanece intacto en
`C:/Users/4riel/Downloads/registro_ventas_unificado.csv`.

- Catálogo: 77 productos; 5 familias; 43 filas de IPs, 40 nombres normalizados únicos.
- CSV original: 150 filas, 150 unidades, $192.400 CLP; Pumpkin y Odisea.
- Tras revisión del usuario: 147 filas/unidades, $184.400 CLP resueltos.
- Pendientes por decisión explícita: Pack Stickers Sanrio Calavera, Pack Stickers
  Madoka y Llavero grumpy cat: 3 filas, $8.000 CLP. No crear productos ficticios.
- Se confirmaron Hada Zelda → Llavero Hada Zelda, Flan → Gato Flan y cinco
  correspondencias homónimas cuyo CSV indicaba Stickers incorrectamente.
- Se conservan tres repeticiones idénticas dentro del CSV, como registros distintos.

`artifacts/etapa-8-1-1-revisado.json` contiene el análisis contra una base vacía,
hashes, fechas y advertencias. Estos totales no aseguran que no haya conflictos con
una base local existente: la vista previa vuelve a compararla antes de escribir.

## Procedimiento

1. Inventario → Importación inicial · Administración.
2. Seleccionar catálogo, familias, IPs y ventas desde el dispositivo. Se pueden
   importar por separado, empezando por las clasificaciones y el catálogo.
3. Generar vista previa. Revisar altas, precios, correspondencias, fechas y pagos.
4. Para el CSV original, usar «Aplicar correspondencias revisadas». Solo funciona
   con el SHA-256 exacto del archivo revisado; aplica las decisiones del usuario y
   deja las tres filas indicadas pendientes. Un archivo diferente requiere revisión.
5. Resolver otras ambigüedades si existen; descargar un respaldo de la base actual.
6. Marcar revisión y escribir IMPORTAR. La operación solo confirma éxito tras
   completar la transacción. No cerrar la aplicación mientras se aplica.
7. Comprobar Historial e Inventario. Los productos nuevos requieren conteo físico
   antes de una venta normal. No se exige conteo para importar.

Las filas pendientes no se marcan como importadas. Cuando se conozcan sus productos,
crearlos correctamente y seleccionar de nuevo el mismo CSV; las filas ya importadas
se omiten. Resolver las tres pendientes manualmente (no volver a aplicar el botón
de decisiones anteriores, que las deja pendientes).

## Formato y reglas

- CSV/TSV UTF-8, BOM opcional, delimitadores coma/punto y coma/tabulador; comillas,
  comillas escapadas y campos multilínea. Máximo 5 MB y 10.000 registros por archivo.
  XLSX no está habilitado en este importador; exportar una copia UTF-8 desde Excel.
- Cabeceras exactas: catálogo `Nombres,Ips,Familias,Precios`; clasificaciones
  `Nombre`; ventas `Evento,Fecha,Hora,Producto,Categoria,Cantidad,Precio_Total,Metodo_Pago`.
- Solo el catálogo original de precio 600 se clasifica como Stickers. Los prefijos
  inequívocos determinan las otras categorías; lo demás requiere revisión.
- Nombres: comparación normalizada del sistema (mayúsculas/espacios); no corrección
  ortográfica ni modificación de asociaciones. Los valores originales quedan auditados.
- Un producto existente se conserva íntegro, incluso archivado, con UUID, precios,
  asociaciones, stock y costos. Se comparan categoría, precio, familia e IP además
  del nombre. Una ambigüedad no se resuelve por parecido.
- El modelo existente exige nombres activos únicos. Si dos formatos usan exactamente
  el mismo nombre, preparar nombres diferenciados en una copia revisada; no forzar
  una correspondencia incorrecta para superar el bloqueo.
- CLP y cantidades enteros seguros; admite `500.0`, rechaza fracciones. Si el total
  no es divisible en unidades enteras por cantidad, bloquea esa fila.
- Fechas YYYY-MM-DD y horas HH:mm:ss interpretadas en America/Santiago, contrastando
  UTC-3/UTC-4. Horas ambiguas o inexistentes se rechazan; otros regímenes históricos
  de zona horaria no están soportados. Se conservan los textos originales.
- Efectivo → cash; Transferencia/MACH o Transferencia → transfer; Débito → debit.
  No se inventan divisiones. Una fila de total cero no genera pagos positivos.
- Cada fila es una venta histórica independiente: **no equivale necesariamente a una
  transacción original**. Estadísticas señalan los registros importados y su promedio.
  Precios históricos salen del total y cantidad originales, nunca del catálogo actual.
- Costos desconocidos; utilidad no disponible. No aplicar promociones actuales.
- Eventos históricos finalizados, con rango observado de ventas, sin activar eventos
  ni cambiar el activo. Ese rango no acredita duración oficial fuera del CSV.

## Persistencia e integridad

IndexedDB pasa de **9 a 10**, únicamente para añadir `importRecords` y un índice
único `by-source`. No reescribe registros existentes. La clave de procedencia es
tipo + SHA-256 de bytes originales + número de registro (cabecera = 1). En CSV con
campos multilínea es número de registro, no número físico de línea de texto.

Cada correspondencia conserva UUID, archivo, hash, fila, lote, fecha y campos
originales. Las ventas añaden `historicalSource`. Reimportar los mismos bytes no
duplica datos; renombrar el archivo tampoco. Editar bytes, BOM u orden cambia el
hash: revisar antes de importar otra versión; no hay deduplicación semántica segura.

`stockCountPending` distingue stock desconocido del cero confirmado. El cero
numérico interno es una base técnica, no un conteo. POS bloquea ventas normales de
esos productos hasta un conteo; alertas de stock bajo los excluyen. El primer conteo
registra `previousStockUnknown`, sin inventar movimientos previos. No se revierte
ese primer punto de referencia mediante una resta ordinaria; se hace otro conteo.

Las ventas importadas no generan movimientos ni descuentan stock. Su anulación
conserva pagos/procedencia y no admite devolución de existencias que nunca descontó.
Respaldos, exportaciones y validación de referencias incluyen procedencia. El formato
JSON sigue en 1; nuevo databaseVersion 10. Hay adaptador explícito para respaldo v9:
verifica checksum original y añade el almacén vacío antes de validar.

Vista previa y aplicación están separadas. Una única transacción sobre los almacenes
valida el snapshot actual, relaciones y pendientes antes de insertar. Cambios locales
posteriores bloquean la vista previa obsoleta. Fallo de cuota/escritura revierte todo.
La vista previa no inserta registros; abrir una base antigua sí ejecuta su migración
estructural habitual. No hay escritura cloud ni dependencia de autenticación remota.
La declaración de responsable en la UI no es un control de seguridad del dispositivo.

## Verificación y límites

- Build y lint correctos; 253 pruebas pasan, ninguna omitida, incluyendo 13 del
  importador. Logs en `artifacts/8-1-1-{build,lint,tests}.log`.
- Se leyó realmente el CSV y las tablas completas; la prueba valida su hash y totales.
- Pruebas con fake-indexeddb: conservación de UUID/stock/precio, reimportación,
  respaldo/restauración, anulación sin stock, conteo inicial, fecha Chile, entradas
  inválidas, selección estable y fallo de cuota después de escrituras con rollback.
- Regresiones de ventas, pagos, costos, combos, promociones, eventos, gastos y
  exportaciones incluidas en la batería existente.
- No se verificó manualmente la UI de esta etapa: CUA falló al inicializarse
  (`failed to write kernel assets`). Pendientes escritorio, 390/425 px, selección
  real de archivos, cierre/reapertura de navegador y Android físico.
- Offline probado a nivel de servicios con fetch no disponible, no con red física.
- Sin importación definitiva, despliegue Google ni sincronización. Datos del usuario
  no inspeccionados ni sustituidos a través del navegador.
- Análisis en memoria y validación del snapshot completo; límites finitos, no
  procesamiento en streaming. No agrupa transacciones sin evidencia.

## Recuperación y continuidad

Ante error, corregir el origen en una copia o regenerar vista previa. Una transacción
fallida no requiere restauración porque revierte. Para deshacer una importación ya
confirmada, usar el respaldo previo mediante el flujo de reemplazo explícito; esto
también reemplaza cambios posteriores, por lo que debe revisarse antes. No borrar
almacenes manualmente.

Etapa 8.2 sigue pendiente: transportar UUID y procedencia, no usar filas de Sheets
como IDs, conservar idempotencia y desconocimiento de stock/costos. No marcar nada
sincronizado sin confirmación real. Estructura futura: `MATU ART/BBDD/MATU ART - Base
de datos` y `MATU ART/Respaldos`, sin prefijos ni carpeta de originales obligatoria.

## Módulos afectados

Nuevos: `types/imports.ts`, `services/importing/{parse,plan,apply,reviewed}.ts`,
`components/importing/ImportManager.tsx`, `tests/importing.test.ts`, fuentes y guía.
Integración: base/snapshot/validación/respaldo/exportación/PDF; tipos catálogo/ventas;
repositorios catálogo/ventas; analytics; Inventory, POS, Home, Statistics;
StockForm, MovementHistory, SaleDetail. Pruebas previas actualizan expectativas de
versión y columna exportada; no se retiraron pruebas. Logo y recursos sin cambios.
