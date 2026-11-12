# D2 — inventario compartido: integración y prueba controlada

Fecha: 2026-11-11. Implementación preparada localmente. **Sin publicación ni prueba
de Firebase real en esta entrega. No comenzar D3 hasta cerrar la validación D2.**

## Alcance integrado

Los formularios existentes de Ajustar stock registran conteos, ajustes y reposiciones
en una transacción IndexedDB que contiene producto proyectado, movimiento y cola.
No hay un segundo formulario de movimientos. El historial existente recibe movimientos
remotos y distingue pendientes, compartidos, conflictos y descartados con auditoría.
La apertura compartida genera una base técnica cero **pendiente de conteo**, nunca un
cero físico confirmado. Un conteo de cero explícito sí produce cero confirmado.

En Mi cuenta aparece Inventario compartido, solo si la variable de activación está
habilitada. La comparación muestra stock local y remoto. El usuario selecciona productos
y decide recibir existencias remotas, dejar pendientes de conteo o confirmar una cantidad
contada. No se precargan cantidades locales en el campo de confirmación. No se suben
ventas, movimientos antiguos ni costos locales. Los saldos/costos originales se preservan
en `originals`, incluidos en el respaldo JSON. Los nuevos costos de apertura son desconocidos,
con advertencia previa; las reposiciones registran costos conforme al motor existente.

Vinculación una vez por producto/conjunto de datos; no antes de cada movimiento. Añadir
un producto nuevo al catálogo no publica sus existencias automáticamente. El producto debe
estar compartido y sin cambios pendientes de catálogo antes de incorporar su inventario.

## Protección acordada para D2

El usuario autorizó bloquear temporalmente **solo las ventas de productos incorporados
a D2** hasta integrar ventas compartidas. El guard está en SalesRepository, no solo en UI.
También bloquea devoluciones de stock mediante anulaciones locales y reversiones locales
sobre esos productos. Se permiten ajustes compensatorios con motivo desde el formulario
compartido; no se implementaron reversiones remotas de recibos. Cambios de costo estimado
local se bloquean en productos vinculados para no sobrescribir el costo compartido.
Los demás productos y las ventas locales existentes siguen funcionando.

No quitar marcas de vinculación ni editar IndexedDB para eludir esta protección. No
desvincular catálogo ni cambiar su propietario mientras haya inventario vinculado.
No se incorporó un flujo de desvinculación de inventario en D2: conserva la trazabilidad.

## Persistencia y concurrencia

- IndexedDB **v12**, migración aditiva: un almacén nuevo `inventorySync`. No cambia UUID
  ni datos antiguos. Guarda propietario/espacio/dispositivo, productos seleccionados,
  saldos confirmados, originales, operaciones y cursor remoto.
- Operaciones llevan UUID estable, actor, dispositivo, fecha, tipo, cantidad, costo,
  motivo, revisión esperada, estado, intentos y error. Las dependencias se representan
  por revisión esperada y orden durable de operaciones del mismo producto.
- Una operación offline conserva el mismo ID tras recarga y reapertura. No se envía
  stock absoluto del producto local. Conteos requieren revisión exacta; cambios concurrentes
  se conservan como conflicto. No se recalculan silenciosamente contra una base nueva.
- Saldo cloud y recibo/movimiento inmutable se confirman en una transacción Firestore.
  Reintento idéntico recupera recibo; distinto contenido con mismo ID se rechaza.
- ACK se obtiene del servidor. Si se corta después del commit pero antes del ACK local,
  el mismo ID recupera el recibo sin repetir efecto. Cola, baseline, movimiento y proyección
  se actualizan juntos en IndexedDB.
- Estado confirmado y proyección local son distintos. Un recibo repetido no duplica
  movimiento. Un conflicto conserva intención original y movimiento; descartarlo exige
  revisión, consulta online del recibo y confirmación. Descarta también las intenciones
  posteriores pendientes de ese producto, sin borrar su auditoría.
- La cuenta original conserva propiedad de su cola. Cambiar sesión no borra ni reasigna
  operaciones. Crear nuevas operaciones offline requiere que la sesión siga disponible;
  si se pierde la sesión al reabrir, hace falta iniciar sesión de nuevo. Las operaciones
  ya guardadas permanecen durables aunque no se pueda iniciar sesión offline.

## Recepción automática y cuota

Un coordinador por origen mediante Web Locks evita duplicar listeners entre pestañas.
El listener de recibos usa páginas de 100, orden por timestamp servidor y UUID. Cursor
y aplicación de página se confirman juntos. Al incorporar productos adicionales se
revisa nuevamente el historial con deduplicación. No hay polling remoto cada dos segundos:
ese intervalo revisa únicamente la cola local y el liderazgo; lecturas Firestore se
realizan por listener, confirmación de operación o comparación explícita.

Lectura inicial de saldos limitada a 2.000 productos; si se supera, falla explícitamente.
La primera vinculación y nuevas incorporaciones pueden recorrer el historial de inventario
del espacio. No descarga ventas. No se ha medido cuota en una feria real. Errores de red,
permisos o cuota mantienen pendientes y activan reintento exponencial hasta 60 segundos.
Reintentar conexión manual sigue disponible. No promete disponibilidad cloud ilimitada.

## Reglas y preparación de publicación

Archivos:

- `firestore.catalog.rules`: reglas C conservadas.
- `tests/firebase/fixtures/inventory.rules.fragment`: extensión de inventario auditada.
- `scripts/build-inventory-rules.mjs`: composición determinista, sin desplegar.
- `firestore.inventory.rules`: reglas compuestas listas para revisión/despliegue.
- `firebase.inventory.json`: configuración explícita que evita desplegar el archivo
  legacy `firestore.rules` de membresía por error.

Las pruebas comprueban que la composición coincide exactamente con el archivo probado.
Se verifica rol (admin/encargado para escribir, miembro activo para leer), rango/tipo,
producto activo, revisión, delta, vínculo saldo-recibo, timestamp servidor, estado pendiente
de conteo, inmutabilidad de recibos y denegación de escrituras sueltas. El promedio con
costo conocido sigue calculado por el cliente según la decisión de confianza del Hito D.
Los costos son visibles para miembros que pueden consultar inventario; no se promete
privacidad de campos dentro del documento.

**No ejecutado en producción.** Secuencia preparada:

1. Revisar el diff y ejecutar `node scripts/build-inventory-rules.mjs`, pruebas y build.
2. Seleccionar un espacio de ensayo y productos expresamente autorizados; respaldar ambos
   dispositivos. No importar el catálogo original otra vez ni usar cantidades de prueba
   como existencias físicas.
3. Publicar las reglas con configuración explícita, tras revisar proyecto destino:
   `npx firebase deploy --only firestore:rules --config firebase.inventory.json --project matu-art`.
   Este comando es instrucción pendiente, no evidencia de un despliegue realizado.
4. Activar la variable pública `VITE_FIREBASE_INVENTORY_ENABLED=true` en el entorno de
   la compilación de ensayo. Para Pages está preparada la variable de repositorio homónima
   y el workflow; por defecto continúa en false. Publicar solo después de verificar UI
   y piloto. No requiere secretos nuevos, Functions ni facturación.
5. Probar primero el candidato en un entorno de ensayo aislado. La incorporación de
   un saldo real exige confirmación específica del propietario. No se ejecuta por login.

## Procedimiento teléfono / computador

1. Abrir la misma versión candidata y entrar con cuentas autorizadas del mismo espacio.
2. Teléfono: Mi cuenta → Inventario compartido → Comparar. Seleccionar **solo** el producto
   autorizado, indicar conteo físico y confirmar la protección de ventas D2.
3. Esperar que la cola llegue a cero; comprobar saldo confirmado en Mi cuenta.
4. Computador: comparar e incorporar el mismo UUID eligiendo recibir saldo remoto.
   Las cantidades locales previas se conservan como originales, no se publican.
5. Teléfono: ajustar -2; observar saldo y movimiento en computador sin pulsar sincronizar.
   Computador: reponer 3 con costo conocido; comprobar recepción en teléfono.
6. Realizar un conteo cero explícito y verificar que no se presenta como pendiente.
7. Desconectar uno, guardar una operación, recargar y comprobar que sigue pendiente.
   Reconectar: confirmar un solo movimiento y una sola modificación del saldo.
8. Crear dos ajustes con la misma revisión: uno confirma y otro requiere revisión.
   No esperar que se sumen automáticamente: revisar el saldo y registrar explícitamente
   la intención que corresponda. No usar una venta para esta prueba (D4 pendiente).
9. Revisar historial y respaldo; no limpiar bases ni descartar conflictos para ocultar fallos.

## Respaldos

Formato JSON sigue en versión 1; databaseVersion 12 distingue el nuevo almacén. Adaptadores
explícitos para 9/10/11 añaden únicamente almacenes faltantes tras verificar el checksum.
Exportar incluye cola, UUID, originales y cursor. Restauración hacia perfil vacío conserva
operaciones y cuenta/dispositivo originales. Restaurar sobre un inventario ya vinculado
se bloquea para no perder operaciones. No usar un respaldo como forma de clonar dos
dispositivos de uso permanente: la identidad de origen se conserva para idempotencia.
No rebajar a una compilación que solo soporte v11 después de abrir v12.

## Verificaciones y limitaciones

315/315 pruebas locales aprobadas al cierre; pruebas
de bases aisladas cubren reapertura, pendientes, backup/restore, migración, conflictos,
desconocido/cero, bloqueo del POS D2, deduplicación y rollback de incorporación inválida.
22 pruebas Auth/Firestore ejecutadas con proyectos demo locales, incluida una integración
de dos IndexedDB aisladas con listener real del SDK contra emulador, ACK perdido y reconexión.
No son dos dispositivos físicos ni Firebase de producción.

El puerto 8080 tenía el emulador Java ya iniciado: se verificó y reutilizó. Auth se inició
por CLI y se detuvo al terminar. `--test-force-exit` se usa en la batería Firebase porque
el SDK mantiene temporizadores después de cerrar los clientes; las aserciones y cleanup
se esperan antes de salir, sin ocultar errores o saltarse tests.

Build/TypeScript, lint y build Pages ejecutados; permanece advertencia de chunks grandes.
La herramienta de navegador falló al inicializar (`failed to write kernel assets`): no
se pudo ejecutar revisión visual de escritorio/móvil en esta sesión. Pendientes revisión
visual de la incorporación, cuotas reales y piloto teléfono/computador. Por ello **D2
no se declara validado en producción**. No se inició D3.
