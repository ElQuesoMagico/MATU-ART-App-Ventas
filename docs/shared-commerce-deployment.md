# Inventario, configuración y ventas compartidas

Estado: 12-11-2026. Sin cambios de identidad visual ni servicios de pago.

## Publicación

Generar reglas con `node scripts/build-inventory-rules.mjs` y
`node scripts/build-commercial-rules.mjs`. Desplegar exclusivamente con:

```
npx firebase deploy --only firestore:rules --config firebase.commercial.json --project matu-art --non-interactive
```

No desplegar el firebase.json legacy. El frontend requiere las variables públicas
`VITE_FIREBASE_INVENTORY_ENABLED=true` y `VITE_FIREBASE_COMMERCIAL_ENABLED=true`.
Su valor predeterminado es false. Publicar Pages solo después de verificar Rules.

## Incorporación y prueba entre teléfono y computador

1. Crear respaldo en ambos dispositivos, actualizar la aplicación e iniciar sesión.
   Verificar que el catálogo está vinculado al mismo espacio.
2. En Mi cuenta, revisar la incorporación de inventario. En el dispositivo de origen,
   seleccionar explícitamente existencias conocidas o pendientes de conteo y confirmar.
   Cero confirmado y cantidad desconocida son estados distintos. No se reconstruye
   inventario desde ventas antiguas. En el segundo dispositivo recibir los saldos
   compartidos; no volver a cargar cantidades como una reposición.
3. Comparar configuración comercial. Revisar eventos, promociones, gastos y precios.
   El primero puede compartir la configuración revisada si la nube está vacía; el
   segundo recibe la existente. Registros locales adicionales bloquean la incorporación
   para impedir mezclas silenciosas; conservar el respaldo y revisar antes de continuar.
4. Esperar confirmación de configuración e inventario. Probar una operación autorizada
   y comprobar su movimiento/saldo en el otro dispositivo. No usar ventas ficticias
   en producción: efectuar el ensayo comercial con conocimiento de su efecto real.
5. Registrar una venta de productos incorporados, comprobar pagos/historial y stock
   en ambos dispositivos. Una venta sin Internet queda pendiente; al reconectar debe
   confirmarse una sola vez. Recargar antes de reconectar verifica la cola durable.
6. Si se anula una venta, indicar motivo y devolución de stock. La anulación queda
   pendiente hasta confirmar en Firestore y devuelve solo lo originalmente descontado.
   Los pagos y descuentos quedan como historia; no se afirma devolución de dinero.

## Protocolo y límites explícitos

- `inventoryBalances` + `inventoryOperations`: saldo y movimiento atómicos con CAS.
- `commercialConfiguration/current` + `configurationOperations`: configuración
  conjunta versionada, máximo 500 kB. Ediciones concurrentes incluso de entidades
  distintas requieren resolución explícita; se guardan ambas versiones localmente.
- `sharedSales` + `saleOperations`: venta/void, pagos y movimientos históricos,
  saldos afectados y recibo inmutable en una misma transacción. UUID de operación
  permanece estable incluso si se perdió la respuesta. Listeners ignoran caché no
  confirmada. No se sincronizan ventas anteriores a la incorporación.
- **Máximo cinco líneas distintas por venta compartida**, límite explícito para
  respetar el presupuesto de acceso/evaluación de Security Rules. No se divide una
  venta silenciosamente. No mezclar productos locales y compartidos en un cobro.
- Se exige conteo conocido y ausencia de movimientos manuales pendientes antes de
  vender un producto compartido. Existencias insuficientes conservan la cantidad
  vendida y registran diferencia no cubierta, sin stock negativo nuevo.
- Costos/descuentos/precios se copian al confirmar localmente; al reconectar se
  concilian los efectos de stock sin recalcular importes históricos.
- Edición aislada de costo estimado y reversión manual de movimientos compartidos
  quedan bloqueadas hasta disponer de un protocolo específico. Reposición mantiene
  el promedio ponderado. Se mantienen las operaciones locales en productos no vinculados.
- No se reemplaza por respaldo una base vinculada: exportar y restaurar en un perfil
  vacío conserva originales, colas y UUID. No se vacía IndexedDB al cerrar sesión.
- Las reglas verifican permisos, relaciones atómicas, revisiones e inmutabilidad;
  no recalculan exhaustivamente el motor de promociones del cliente (decisión aceptada).
- Cuotas Spark siguen siendo limitadas. Configuración agregada y recibos históricos
  crecen; el error de tamaño se muestra en lugar de publicar parcialmente.

## Verificación ejecutada

324 pruebas locales aprobadas (323 pertenecen a esta publicación), 27 pruebas de
Auth/Firestore en emuladores aprobadas, TypeScript, lint y build Pages aprobados.
Incluye stock desconocido/cero, reintentos, concurrencia, cola reabierta, venta cero,
pagos divididos, anulaciones, máximo cinco líneas, permisos, configuración concurrente,
respaldos y conservación de copias históricas. Dos IndexedDB independientes usan
listeners reales del SDK contra emuladores; desconexión mediante SDK, no modo avión.
No se realizó prueba comercial en Firebase real ni prueba visual/física móvil.
La herramienta de navegador falló al iniciar. La comprobación manual queda pendiente.

## Registro de despliegue

12-11-2026: Firebase CLI compiló y publicó `firestore.commercial.rules` en `matu-art`.
Variables de Pages de inventario y comercio activadas. Frontend `03ae140` publicado
correctamente por [GitHub Actions 43327472657](https://github.com/ElQuesoMagico/MATU-ART-App-Ventas/actions/runs/43327472657).
La URL pública responde HTTP 200 y sirve el bundle con los módulos comerciales nuevos.
La ejecución de CI completó lint, pruebas, build y despliegue.
No se escribieron datos comerciales en producción.
