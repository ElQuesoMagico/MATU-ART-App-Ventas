# Google Sheets — esquema propuesto v1 (sin datos migrados)

Una hoja privada por despliegue/emprendimiento. Sin contraseñas, sesiones ni secretos.
La cuenta del vendedor nunca necesita acceso directo a Google. UUID como texto; las
filas pueden ordenarse o moverse y **nunca** son identificadores. No crear fórmulas
desde valores del usuario; futuras escrituras deberán usar texto literal/formato
seguro y validar tamaño. Los reportes existentes siguen leyendo IndexedDB.

Crear manualmente estas pestañas con una única fila de cabeceras, exactamente:

`id | workspaceId | revision | updatedAt | operationId | payloadJson`

| Pestaña | Contenido futuro de payloadJson y relaciones |
| --- | --- |
| products | Producto, categoría/familias/IPs por UUID, stock, costos, eventPrices, packContents; imagen requiere referencia durable, nunca blob: |
| categories | Categoría principal, nombre/orden/archivo |
| families | Familias UUID independientes |
| ips | IPs UUID independientes |
| promotions | Promociones y combos discriminados por tipo, destinatarios/eventos por UUID |
| events | Eventos administrados; referencias de ventas legacy se conservan en sus snapshots |
| sales | Copia inmutable completa: líneas, precios/costos, descuentos/promos/combos, evento y anulación |
| payments | UUID, saleId, método e importe histórico |
| movements | UUID, productId, stock antes/después, venta/reversión/reversedBy por ID |
| costChanges | UUID, productId, costo anterior/nuevo y auditoría |
| expenses | UUID, categoría, evento opcional, importe, estado, motivo/anulación |
| expenseCategories | UUID, nombre y estado |
| expenseChanges | UUID, expenseId, cambio auditable |
| syncOperations | id=operationId; deviceId, payloadHash, entidad/grupo, expectedRevision, estado, ACK, error/conflicto, timestamps |
| audit | UUID, actor del servidor, operación, resultado, fecha y referencias; sin credenciales |

`revision`: entero monotónico de registro; `updatedAt`: ISO UTC; `workspaceId`:
identidad asignada por servidor, no permiso suministrado por cliente. `operationId`:
UUID de operación causante. `payloadJson`: JSON versionado por entidad que conserva
snapshots sin aplanar ni recalcular valores históricos. Los IDs de pagos/movimientos
referencian UUID reales. UUID de producto, evento y operación se mantienen estables.

El gateway v1 solo verifica que existan pestañas y cabeceras. No importa, escribe,
cuenta ventas ni modifica filas. `ready:true` confirma únicamente esa estructura.
La definición es una base para 8.2, no un esquema de sincronización ya desplegado.

Antes de escrituras: implementar validación de payload por entidad, versión de
contrato, unicidad operationId/payloadHash, journal de operaciones parciales,
compensación/recuperación, serialización mediante LockService o coordinador, ACK
durable y resolución explícita de conflictos. No confiar en un simple appendRow
para idempotencia. Si la misma operationId llega con otro hash debe rechazarse.
No distribuir globales ni duplicar ingresos al procesar pagos divididos. No usar
fechas del cliente como autorización ni sustituir revisiones por hora de llegada.


## Organización acordada e importación 8.1.1

Drive futuro: `MATU ART/BBDD/MATU ART - Base de datos` y `MATU ART/Respaldos`.
Sin prefijos numéricos ni carpeta obligatoria de archivos originales. No se crearon
carpetas ni se enviaron datos en esta etapa.

Añadir a la propuesta futura la entidad `importRecords`: UUID, sourceKey único
(tipo/hash/fila), sourceHash, sourceName, kind, row, targetId, batchId, createdAt y
original. Los productos conservan stockCountPending y las ventas historicalSource.
No tratar el cero técnico pendiente como inventario confirmado. La procedencia debe
viajar con las ventas cuando se implemente 8.2; no hay transporte activado todavía.
