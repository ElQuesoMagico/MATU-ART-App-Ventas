# Etapa 8.2 — en curso, sin despliegue ni sincronización habilitada

Auditoría del 21-10-2026. La decisión posterior del usuario es alojar primero el
frontend en GitHub Pages, sin dominio propio y sin Workers Paid contratado.
Esto cambia la premisa de mismo origen de 8.1. Consultar [GitHub Pages](github-pages.md)
antes de desplegar; **no asumir sesiones fiables entre github.io y workers.dev**.

| Componente | Estado comprobado |
|---|---|
| Frontend y datos locales | Funcionales; DB v10, sin migración nueva en esta etapa |
| Compilación Pages raíz/subcarpeta | Preparada y probada localmente |
| Workflow de Pages | Manual, creado; no ejecutado en GitHub |
| Hosting GitHub real | No publicado ni verificado |
| Worker autenticación v1 | Código existente; TypeScript verificado; no desplegado |
| Wrangler | `whoami`: no autenticado; no usar despliegue temporal como producción |
| D1 remoto | ID de ejemplo en configuración; no creado ni migrado |
| Apps Script | Code.gs v1 existente, lectura; sin despliegue real verificado |
| Sheets | Usuario creará hoja en BBDD; no inspeccionada ni inicializada |
| Sesiones github.io → workers.dev | No habilitadas; requieren decisión arquitectónica |
| Sincronización catálogo | Contrato y módulos preparatorios; NO integrada ni habilitada |
| Datos comerciales cloud | Ninguno enviado por esta implementación |

## Cambios locales realizados

- Vite `MATU_BASE_PATH`, manifiesto PWA con rutas relativas y logo original,
  aislamiento de cachés por scope, exclusión de APIs y otros proyectos del origen.
- Workflow manual que publica solo dist y mantiene VITE_CLOUD_API_URL vacío.
- Acceso a conexión movido a Inventario → Datos y respaldos → Conexión a la nube.
- Contrato `catalogContract.ts`: categorías/familias/IPs/productos, UUID y revisiones,
  validación estricta, referencias, nombres activos, conflicto explícito sin LWW.
- Producto cloud proyectado: identidad, nombre, descripción, categoría, familias,
  IPs, precio general, favorito, archivo, tipo y fechas. `stockPolicy: local-only`.
  No stock, costos, movimientos, imágenes, precios de evento ni contenido de packs:
  esos campos requieren tratamiento explícito posterior; no eliminarlos localmente.
- `backend/src/catalog.ts` prepara autorización administrativa, diario D1, vínculo
  operationId/payloadHash/actor y verificación de ACK. `catalogGateway.ts` prepara
  mensajes v2 y respuestas firmadas, límites y redirección segura. **No se añadieron
  rutas a index.ts**, no son endpoints disponibles. No existe adaptador GAS v2 aún.
- `0002_catalog_operations.sql` preparada, **no aplicada**; no altera autenticación.

Estos módulos no constituyen un motor de sincronización completo. Falta la cola
durable local, vista previa, selección/exclusión de datos de prueba, descarga,
resolución de conflictos y coordinación final con Sheets. No registrar un estado
"Sincronizado" ni avanzar a inventario compartido con el código preparatorio.

## Diseño pendiente para escrituras de Sheets

Reutilizar las cabeceras de sheets-schema.md. No escribir varias pestañas con
setValues independientes y devolver éxito parcial. La propuesta es ScriptLock +
validación CAS + una llamada Advanced Sheets `spreadsheets.batchUpdate` que aplique
entidades, diario de operación y auditoría conjuntamente. Google documenta atomicidad
de sus subsolicitudes; no equivale a transacciones SQL ni protege de ediciones humanas
externas. Restringir edición directa de pestañas sincronizadas y detectar alteraciones.

Ante timeout, conservar el mismo operationId/payload y consultar el diario remoto.
No confirmar D1 antes de ACK verificable de Sheets. Si Sheets confirma pero falla
D1, reintentar conciliando el mismo diario. No reescribir a ciegas ni cambiar el
operationId. La implementación y pruebas de fallos de este protocolo están pendientes.

Activar Advanced Sheets y ampliar scope de Apps Script a escritura requiere una
decisión explícita del usuario antes de autorizar/desplegar. Code.gs continúa en
modo lectura v1, sin nuevas autorizaciones. URL pública no sustituye HMAC.

## Decisiones de producción conservadas

No subir los 4 productos/9 ventas del respaldo de pruebas ni restaurarlo. No se
leyó ni modificó ese JSON/Excel. Carpetas existentes según usuario: MATU ART/BBDD y
MATU ART/Respaldos. Hoja prevista: MATU ART - Base de datos. Sin carpetas adicionales.

Catálogo real: 77 productos originales. Nueva decisión: mantener ambos packs como
productos; Llavero grumpy cat solo como referencia histórica archivada. Aún faltan
datos maestros completos de los packs y la política de precio desconocido para una
referencia histórica: no inventar precio, categoría/IP/familia, stock ni costo. Las
tres filas siguen pendientes en el importador; preparar su revisión antes de cambiar
su tratamiento. Las 150 ventas no se sincronizan en 8.2.

## Seguridad y contratación

No se cambian scrypt ni las cookies HttpOnly/Secure/Strict, CSRF, CORS exacto o roles.
Ningún token en almacenamiento local. No secretos nuevos ni credenciales de prueba
en producción. Frontend github.io funciona localmente; cloud bloqueada hasta decidir
dominio/proxy o revisar un diseño de autenticación alternativo.

Workers Free tiene 10 ms CPU por solicitud. No reducir scrypt para adaptarlo: el
backend actual requiere capacidad Paid y medición, además de límites de uso. No se
ha autorizado compra. Dominio, hosting estático, Workers y cuotas D1 son conceptos
distintos; preparar cuentas/código no obliga a contratar. No iniciar despliegue ni
aceptar permisos ampliados sin la decisión del responsable.

## Verificación ejecutada

Build estándar y build con `/matu-art/`: correctos; HTML, favicon, fuente, manifiesto
y recursos generados apuntan a la subcarpeta. Lint y TypeScript backend correctos.
Batería: 258 pruebas aprobadas, incluyendo cinco nuevas para contrato CAS,
referencias, autorización, rechazo cross-site y aislamiento de caché.

Navegador real de la herramienta, origen aislado `127.0.0.1:5191/matu-art/`: Inicio
en escritorio, acceso al POS en viewport390×844, Inventario/Datos en425×876. Sin
desbordamiento horizontal medido. Servidor de prueba detenido y recarga de Inventario
desde caché satisfactoria, panel Datos abierto después de detenerlo. No implica
prueba de Android físico, instalación PWA ni caída física de Internet. Base de QA
vacía; no modificó el origen del usuario. Evidencia artifacts/8-2-pages-offline-425.png.

Pruebas del contrato son locales, no integración real con Google. Pendientes:
workflow en GitHub, cookies/dominio productivo, Cloudflare remoto, D1 remoto, GAS,
escritura/lectura real de Sheets y sincronización E2E. Etapa 8.2 no completada.

## Continuar después de compactar

Primero resolver hosting/autenticación con el usuario y obtener nombre del repositorio
(no secretos). Seguir acciones de github-pages.md de una en una. No iniciar
automáticamente wrangler login, crear recursos duplicados o publicar el workflow.
Mantener el backend v1 funcional mientras se termina el v2; no exponer catalog.ts
hasta completar validaciones GAS, límites, outbox y pruebas de recuperación.
No comenzar 8.3. README/PROJECT_CONTEXT conservan los resultados históricos anteriores.

Referencias oficiales revisadas:
[batchUpdate atómico](https://developers.google.com/workspace/sheets/api/guides/batch),
[Advanced Sheets](https://developers.google.com/apps-script/advanced/sheets),
[límites Workers](https://developers.cloudflare.com/workers/platform/limits/).

## Decisión confirmada y continuación — 23-10-2026

El usuario eligió «Preparar Pages; nube pendiente». No está pendiente elegir entre
Pages y dominio ahora: terminar publicación estática y posponer la nube. Se añadió
scripts/build-pages.mjs y npm build:pages con validación del paquete; el workflow
manual lo utiliza. Datos originales y artifacts excluidos de Git, sin eliminarlos.
No se cambió IndexedDB, autenticación ni Apps Script. Falta URL del repositorio y
la publicación autorizada para poder verificar github.io realmente.
