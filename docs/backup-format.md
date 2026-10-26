# MATU ART: respaldo completo, formato 1

El esquema ejecutable está en `src/services/data/backupValidation.ts`. Este documento
define el contenedor y el protocolo; los tipos comerciales continúan en `src/types/`.

```json
{
  "application": "MATU ART",
  "formatVersion": 1,
  "databaseVersion": 9,
  "generatedAt": "2026-10-15T12:00:00.000Z",
  "counts": { "products": 0, "...": 0 },
  "data": { "products": [], "...": [] },
  "sha256": "64 caracteres hexadecimales"
}
```

Los puntos suspensivos son ilustrativos: todos los almacenes deben estar presentes,
incluso vacíos: `products`, `categories`, `families`, `ips`, `movements`, `costChanges`,
`sales`, `payments`, `metadata`, `events` (legacy), `managedEvents`, `promotions`,
`expenses`, `expenseCategories` y `expenseChanges`. `counts` identifica las cantidades.
No se respaldan carrito temporal, búsquedas, ventanas abiertas ni caché de archivos.
No hay credenciales ni una cola de sincronización implementada en v9.

Cada fila conserva UUID, nombres e información persistida sin recalcular precios,
costos, descuentos, pagos, promociones ni stock. Las claves con valor `undefined`
se omiten, como corresponde a JSON; su ausencia conserva el significado de costo
desconocido y se distingue del número cero. Los importes son números enteros CLP.
Las referencias de eventos históricos en ventas son copias autónomas; no se inventan
eventos reales para sustituir referencias legacy. Las promociones aplicadas conservan
su configuración histórica aunque la promoción vigente cambie o esté archivada.

## Imágenes

El único valor no JSON actual es `products[].image`, convertido desde Blob a:

```json
{ "encoding": "base64", "mime": "image/png", "bytes": 1234, "data": "..." }
```

La restauración reconstruye un Blob con el mismo contenido y MIME. Nunca se guardan
URLs `blob:`, rutas temporales ni dependencias de servidores externos. Se valida
Base64, longitud, MIME y firma del formato. Los archivos oficiales de la aplicación
se distribuyen con el código y no se duplican como datos comerciales del respaldo.

## Integridad y límites

SHA-256 se calcula sobre el contenedor sin `sha256`, serializado de forma canónica:
claves de objetos ordenadas por comparación de cadenas JavaScript (independiente del
idioma), arrays en su orden original, valores JSON estándar, omisión de `undefined`,
sin espacios, bytes UTF-8. Detecta alteraciones accidentales; **no es una firma digital
ni cifrado**. Un archivo modificado por un tercero se sigue tratando como no confiable.

Además del hash se validan entidades, tipos, UUID, duplicados, referencias, importes,
pagos frente al total, stock anterior/posterior, contador de ventas, vínculos de
movimientos y cadena de auditoría de gastos. No se ejecutan instrucciones del archivo.
Se rechazan claves `__proto__`, `constructor` y `prototype`.

Límites explícitos: archivo JSON de 128 MB, 250.000 registros y 64 MB acumulados de
imágenes al generar el respaldo; imagen importada de hasta 10 MB. El formulario de
productos conserva su límite existente de 5 MB. Los límites producen errores, nunca
archivos truncados. La generación y validación se ejecutan en Web Workers.

## Restauración

1. Seleccionar JSON y validar su versión, hash, tipos y referencias.
2. Leer un snapshot consistente de todos los almacenes locales y mostrar cantidades
   locales y entrantes. Recomendar guardar primero un respaldo actual y cerrar otras
   pestañas de MATU ART.
3. Exigir escribir `RESTAURAR` y pulsar `Reemplazar datos locales`.
4. Abrir una transacción `readwrite` que bloquea todos los almacenes. Comparar la base
   con el estado de la vista previa; si cambió, abortar y exigir una nueva validación.
   El token incluye revisiones, valores y metadatos de imágenes; las operaciones del
   catálogo siempre aumentan la revisión al modificar una imagen.
5. Bloquear la operación ante almacenes desconocidos o claves de metadatos no
   reconocidas: no asumir que una futura cola pendiente de sincronización es descartable.
6. Vaciar y reponer todos los almacenes en la misma transacción. Releer y comparar
   registros antes del commit. Un error de cuota, índice, escritura o validación aborta
   también los vaciados: no queda una base parcialmente restaurada.
7. Esperar `tx.done`, refrescar otras pestañas por BroadcastChannel y recargar la
   aplicación para descartar formularios y carrito previos. No hay mezcla automática.

La restauración no constituye una operación de sincronización. Las escrituras que
terminan antes de tomar el bloqueo se detectan en el token; no deben mantenerse otras
sesiones operando deliberadamente durante un reemplazo completo.

## Evolución

`formatVersion` es independiente de `databaseVersion`. Este lector admite formato 1
con el esquema actual v9. Un cambio futuro requiere un adaptador explícito y testeado
del par (formato, esquema origen) hacia el esquema destino **antes** de iniciar la
transacción de reemplazo. Hasta disponer del adaptador, se rechaza esa versión sin
escribir. Nunca aceptar un respaldo solo porque su versión es menor, ni omitir
almacenes nuevos silenciosamente. Conservar el archivo original de respaldo.

No se cambió la versión de IndexedDB en la Etapa 7.3.


## Extensión compatible 8.1.1

El ejemplo anterior describe v9. Los respaldos nuevos usan databaseVersion 10 y
mantienen formatVersion 1. Incluyen un almacén adicional obligatorio `importRecords`
y los campos opcionales stockCountPending, previousStockUnknown e historicalSource.
La validación comprueba referencias y la ausencia de movimientos de ventas importadas.
El adaptador de v9 verifica primero el SHA-256 original, agrega importRecords vacío
y valida todo el resultado. No se aceptan versiones arbitrarias. El formato nuevo
requiere esta versión de la aplicación; una versión antigua no debe restaurarlo.
