# Etapa 8.1 — Infraestructura de conexión

Estado: código preparado y probado localmente. **No desplegado ni conectado a una
hoja real. No hay sincronización, copia cloud ni envío de registros locales.**

## Arquitectura y límites de alcance

```text
React / IndexedDB v9 (operación local, sin cambios)
  └─ cliente HTTPS /api, cookie HttpOnly
       └─ Cloudflare Worker + D1 (cuentas, sesiones, límites)
            └─ POST HTTPS con cuerpo firmado HMAC
                 └─ Apps Script (solo ping/metadatos)
                      └─ Google Sheets (solo lectura de estructura)
```

Un despliegue representa **un emprendimiento**. No existe aún aislamiento cloud
multiempresa ni vinculación automática de una cuenta a los datos locales. Cambiar
de usuario no cambia/vacía IndexedDB. Autenticarse no otorga protección al catálogo
local de un equipo compartido: su acceso sigue dependiendo del dispositivo/perfil.
La autorización descrita aquí aplica exclusivamente a los endpoints del servidor.

Producción exige frontend y API en **el mismo origen HTTPS**, con una ruta Worker
`https://tu-dominio/api/*`. Así se usan cookies host-only `__Host-matu-session`,
Path=/, HttpOnly, Secure, SameSite=Strict, sin Domain. No se admite un frontend
en un dominio y la API en workers.dev como configuración final. Localmente se
permite HTTP **localhost** con distintos puertos, origen exacto configurado.
No cambiar el origen actual de los datos sin planificar su traslado por respaldo:
localhost/127.0.0.1/puertos distintos tienen bases IndexedDB distintas.

## Contraseña, sesiones y autorización

- scrypt versionado `scrypt-v1`, sal aleatoria individual de 16 bytes, clave de
  32 bytes, N=16384, r=8, p=5, memoria aproximada 16 MiB; comparación constante.
  Es una de las configuraciones alternativas de [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
  D1 solo contiene verificadores. No usar SHA-256 solo como hash de contraseñas.
- Primer administrador: herramienta interactiva local, contraseña 16–256 caracteres,
  entrada oculta. Sin endpoint de bootstrap, registro público, contraseña por URL,
  argumentos o variables VITE_. INSERT condicional atómico solo si no hay usuarios.
- Sesión opaca de 32 bytes aleatorios; D1 conserva solo SHA-256 del identificador.
  Expira a las 8 horas absolutas, sin renovación silenciosa. Login rota la sesión
  del navegador; logout la elimina en D1 y vence la cookie. Desactivar la cuenta
  revoca efectivamente todas sus sesiones al consultarse `users.disabled` en cada
  petición. Cron horario limpia sesiones y contadores vencidos.
  Sin conexión no se puede revocar una sesión en el servidor: la interfaz informa
  el fallo, no confirma un logout ficticio. Se debe reintentar con red; la expiración
  absoluta sigue vigente aunque se cierre el panel o el navegador.
- CSRF: todas las mutaciones exigen Origin exacto y JSON; logout y prueba de conexión
  exigen además token aleatorio de sesión en X-CSRF-Token. Solo se mantiene en memoria
  React. Login tiene protección de Origin/JSON, incluida prevención de login CSRF.
- No JWT, tokens en localStorage/IndexedDB, caché de credenciales ni Google Login.
  El Service Worker excluye explícitamente `/api`. Respuestas no-store.
- Límites D1 con UPSERT atómico: 5 intentos/usuario/15 minutos, 30/IP/15 minutos,
  120 globales/minuto; cuentan también accesos correctos. No se reinician por reiniciar
  Worker. IP de CF-Connecting-IP, nunca X-Forwarded-For. La clave se guarda hasheada.
  Pruebas de conexión: 5/minuto/usuario. Cuerpos JSON máximos 4096 bytes.
- D1 sin réplicas de lectura habilitadas. Si se habilitan en el futuro, incorporar
  Sessions API/lecturas primarias para que logout/roles no utilicen datos obsoletos.
- Errores uniformes `{version:1,ok:false,error:{code}}`; no se envían trazas,
  identificador de hoja, secreto ni respuesta cruda de Apps Script. Logs del Worker
  deshabilitados por defecto; no añadir logging de cookies, cuerpos ni contraseñas.

| Endpoint | Acceso |
| --- | --- |
| GET /api/status | Público; solo status/version, no consulta Sheets |
| POST /api/auth/login | Credenciales + origen, límites persistentes |
| GET /api/auth/session | Sesión vigente; devuelve usuario, rol, expiración, CSRF |
| POST /api/auth/logout | Sesión + origen + CSRF |
| POST /api/connection/test | Administrador o Encargado + sesión/origen/CSRF |

Vendedor puede iniciar/consultar/cerrar su sesión, pero no probar el gateway.
No hay endpoints de ventas, inventario, usuarios ni sincronización. No confiar en
roles enviados por el cliente. La política de permisos comerciales de 8.2 está pendiente.

## Configuración local (sin recursos remotos)

Requiere Node 24. Desde `backend/`:

```sh
npm ci
npm run check
npx wrangler d1 migrations apply matu-art-auth --local
npm run bootstrap -- --local
npx wrangler dev --ip localhost --port 8787 --var APP_ORIGIN:http://localhost:5173
```

En el frontend, copiar `.env.example` a `.env.local`, configurar solamente
`VITE_CLOUD_API_URL=http://localhost:8787/api` y ejecutar Vite en localhost:5173.
Para otro puerto cambiar también APP_ORIGIN. `.dev.vars.example` pertenece únicamente
al backend y nunca se copia a `src/` ni `public/`. Sin configuración GAS la prueba
autenticada informa CONNECTION_FAILED, pero login y operación local siguen funcionando.
No usar las cuentas QA de pruebas como credenciales de producción.

## Configuración de producción

1. Crear cuenta Cloudflare y un dominio/origen HTTPS para la PWA. Instalar dependencias
   del backend; ejecutar `npx wrangler login` en el equipo del responsable (esto es
   acceso del **desarrollador a Cloudflare**, no login del vendedor).
2. Crear D1: `npx wrangler d1 create matu-art-auth`. Copiar el database_id devuelto
   en `backend/wrangler.jsonc`; es identificador, no contraseña. Mantener binding DB.
3. Aplicar `npx wrangler d1 migrations apply matu-art-auth --remote`. Esta migración
   crea únicamente D1; **no modifica IndexedDB**.
4. Configurar APP_ORIGIN con el origen final exacto, sin slash final; añadir la ruta
   `/api/*` del dominio mediante el dashboard o `routes` de Wrangler. Mantener
   workers_dev=false. No usar reglas de caché de CDN sobre /api. HTTPS obligatorio.
5. Crear una hoja **privada** propiedad de la cuenta técnica del responsable. Preparar
   las pestañas/cabeceras de [sheets-schema.md](sheets-schema.md). No importar datos.
6. Crear proyecto Apps Script independiente; copiar `apps-script/Code.gs` y manifest.
   Conservar alcance `spreadsheets.readonly`. En Propiedades del script configurar:
   - SPREADSHEET_ID (solo servidor).
   - GATEWAY_KEYS, objeto JSON `{ "v1": "<64 caracteres hex aleatorios>" }`.
   Generar el secreto con un gestor seguro local, no en este chat ni en el código.
7. Desplegar Apps Script como aplicación web, ejecutar como propietario, acceso para
   recibir solicitudes del Worker. Si requiere «Cualquiera», la URL será pública,
   pero `doPost` exige firma válida antes de tocar Sheets. Autorizar permisos de
   lectura desde la cuenta propietaria. Si la política Workspace impide ese modo,
   esta arquitectura requiere revisión; no abrir una ruta anónima alternativa.
8. Configurar GAS_URL del Worker con el `/exec` del despliegue, GAS_KEY_ID=v1.
   Ejecutar `npx wrangler secret put GAS_SECRET` y pegar allí el secreto desde el
   gestor local. No pasarlo en argumentos, commits, frontend ni mensajes.
9. Ejecutar `npm run bootstrap -- --remote`; crea solo la primera cuenta y solicita
   contraseña ocultamente. El archivo SQL temporal contiene el verificador, se crea
   con modo restrictivo y se elimina al terminar; usar un equipo/temporales confiables
   (en Windows revisar ACL del perfil). Si ya hay usuarios no los reemplaza.
10. Configurar capacidad CPU adecuada (ver cuotas), `npm run check`,
    `npx wrangler deploy --dry-run`, después `npm run deploy`. No se ejecutó ningún
    deploy remoto durante esta implementación.
11. Frontend `.env.production.local`: `VITE_CLOUD_API_URL=/api`; build y publicar solo
    `dist/`. Nunca publicar backend/, .dev.vars, .wrangler o Apps Script como assets.
12. Desde Inventario → Conexión a la nube, iniciar sesión, consultar sesión y probar
    Sheets. `ready:false` significa autenticación/lectura correctas pero estructura
    de hojas incompleta. `ready:true` no significa que haya datos sincronizados.

Antes de habilitar a vendedores, comprobar en producción cookies Secure/HttpOnly,
logout/expiración, rol, solicitudes sin firma/replay rechazadas y CPU/cuotas. Hacer
un respaldo de D1 desde sus herramientas. El JSON de MATU ART respalda únicamente
datos locales, **no cuentas ni sesiones**.

## Apps Script: contrato y rotación

La documentación de [web apps](https://developers.google.com/apps-script/guides/web)
expone `e.postData.contents`, no encabezados arbitrarios. No se usa Authorization
ni se presupone que doPost pueda leerlo. El cuerpo es:

```json
{"keyId":"v1","payload":"<JSON exacto serializado>","signature":"<HMAC-SHA256 hex>"}
```

Payload v1: `{version:1,requestId:UUID,timestamp:epochMilliseconds,operation:"ping"|"metadata"}`.
Firma sobre `keyId + "\n" + payload`, UTF-8, secreto como texto hexadecimal; ambos
servidores usan exactamente los mismos bytes. Timestamp ±60 s; nonce persistente
125 s en ScriptProperties bajo ScriptLock, máximo 200 nonces vivos, falla cerrado.
No CacheService para replay (puede desalojar datos). No operaciones de escritura
comercial aunque la firma sea válida. Metadatos devuelven solo schemaVersion/ready.

[ContentService](https://developers.google.com/apps-script/guides/content) redirige
la salida. Worker sigue únicamente 302/303 a `https://script.googleusercontent.com`
mediante GET **sin reenviar el cuerpo firmado**; valida tamaño, versión, requestId,
ok y forma de respuesta. Timeout 12 s. No reintentos automáticos de esta prueba.
ContentService no permite elegir libremente código HTTP: comprobar siempre `ok`.

Rotación: añadir v2 al JSON GATEWAY_KEYS manteniendo temporalmente v1; actualizar
GAS_SECRET y GAS_KEY_ID del Worker en una ventana coordinada, probar; retirar v1
después de 125 s sin solicitudes antiguas. Un fallo durante rotación solo bloquea
pruebas de nube, no ventas locales. Ante compromiso retirar la clave inmediatamente,
aceptando interrupción; renovar sesiones si también se compromete D1. No registrar
payloads firmados ni secretos. El nonce no sustituye la futura idempotencia comercial.

## Cuotas y riesgos operativos

Fuentes oficiales consultadas 16-10-2026; verificar nuevamente al desplegar:

- [Workers](https://developers.cloudflare.com/workers/platform/limits/): Free 100.000
  solicitudes/día, 10 ms CPU/solicitud, 128 MB. **Este scrypt no está dimensionado
  para el límite Free de 10 ms**; se requiere capacidad CPU de pago y medirla en
  producción. La petición local de login tardó aproximadamente 204 ms de tiempo
  total (no es medición CPU de producción). No reducir hashing para caber en Free.
- [D1](https://developers.cloudflare.com/d1/platform/limits/) y
  [precios/cuotas](https://developers.cloudflare.com/d1/platform/pricing/): revisar
  lecturas/escrituras diarias y almacenamiento del plan. Cada login consume varias
  operaciones; un abuso también consume cuota. Los límites de aplicación no
  sustituyen protección de tráfico Cloudflare/WAF ni alertas de uso.
- [Apps Script](https://developers.google.com/apps-script/guides/services/quotas):
  6 minutos/ejecución, 30 ejecuciones simultáneas por usuario, propiedades limitadas
  a 9 KB/valor y 500 KB totales, cuotas diarias por cuenta (50.000 lecturas/escrituras
  de propiedades en cuentas consumidor). La URL pública puede recibir abuso antes
  de verificar HMAC y consumir cuota; la firma protege datos, no disponibilidad.
- scrypt está verificado en workerd local con
  [node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
  No afirmar rendimiento equivalente en infraestructura remota.
- No hay recuperación por correo, MFA, UI de gestión de usuarios ni alta pública.
  Para emergencia el operador D1 puede desactivar un usuario (`disabled=1`) y borrar
  sus sesiones mediante herramientas autorizadas. No improvisar reset anónimo.

## Preparación de 8.2, todavía sin implementación

`src/services/cloud/contracts.ts` define FutureSyncOperation con UUID de operación,
dispositivo, workspace, entidad, revisiones, estado pending/confirmed/conflict,
intentos y confirmación. No genera IDs de dispositivos ni persiste una cola aún.

Puntos de integración futuros inspeccionados:

| Repositorio | Operaciones que deberán producir una outbox atómica local |
| --- | --- |
| catalogRepository | createProduct, updateProduct, setArchived, recordMovement, reverseMovement; costos/imágenes |
| classificationRepository | save de categorías/familias/IPs |
| salesRepository | confirm y voidSale; venta+pagos+movimientos+stock como grupo |
| promotionRepository | save/estados de promociones y combos |
| eventRepository | save, activate, changeState y revisión de precios |
| expenseRepository | save, void, createCategory y auditoría |

No escribir outbox fuera de las transacciones comerciales. Antes de 8.2 definir
tenant/dispositivo, permisos por entidad, conflicto de revisiones, orden causal,
almacenamiento de imágenes y números de venta locales repetidos. UUID siempre como
identidad. Un timeout no confirma ni descarta una operación: reintentar con el mismo
operationId/payload y exigir ACK real. Una revisión incompatible produce conflicto
explícito, sin last-write-wins sobre ventas/costos históricos. Sheets no ofrece una
transacción multitabla equivalente a IndexedDB: se deberá diseñar journal/idempotencia,
recuperación y concurrencia antes de activar escrituras. Adaptar respaldos/restauración
para bloquear reemplazo con outbox pendiente. No implementado en esta etapa.

## Revisión de despliegue 21-10-2026 (8.2 en curso)

El usuario eligió GitHub Pages bajo github.io sin dominio. La receta anterior de
mismo origen no se aplica directamente a workers.dev: no cambiar SameSite a None
como solución suficiente. Ver github-pages.md y cloud-8.2.md. No hay deploy ni
nuevos permisos de Google; Code.gs aún es v1. El contrato v2 preparatorio de catálogo
no está habilitado. Workers Paid sigue sin contratar; scrypt permanece intacto.
