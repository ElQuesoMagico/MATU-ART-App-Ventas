# Firebase Spark — configuración paso a paso

## Estado al 3 de noviembre de 2026

El usuario confirmó proyecto `matu-art`, Authentication correo/contraseña,
Firestore Standard, dominio autorizado `elquesomagico.github.io` y estas membresías.
La captura aportada el 03-11-2026 confirma acceso real desde la aplicación local
a Firestore como Administrador. No implica sincronización comercial ni publicación.

- Workspace: `workspaces/byhkbCSyvenq9SDAjoRm`.
- Campos: `name: "MATU ART"`, `schemaVersion: 1` (número entero).
- Miembro `mOcpmuG9Hzajjd5q0jH9g5Rl6A83`: `role: "seller"`, `enabled: true`.
- Miembro `EfuGpacNLgMqX0dh9oQJ9fb6cir2`: `role: "administrator"`, `enabled: true`.
- Los miembros están en `workspaces/{workspaceId}/members/{uid}`.
- El usuario intercambió los roles intencionalmente y lo confirmó. No revertirlos.
- El primer intento falló porque `members` estaba en la raíz. Las reglas requieren
  la subcolección del workspace. No se borró la colección raíz ni se debilitaron reglas.

Los identificadores no son contraseñas. No incluir credenciales ni claves privadas
en documentos, repositorio o chat. No activar facturación, Storage, Functions o Run.

## Reglas iniciales (parte del Hito B)

`firestore.rules` permite exclusivamente obtener el workspace y la membresía propia
a usuarios autenticados, habilitados y con rol administrator, manager o seller.
No permite enumerar workspaces/miembros, consultar otros miembros, cambiar permisos
ni leer/escribir entidades comerciales. También bloquea escrituras administrativas.
La consola del propietario permite administrar membresías fuera del cliente.

El usuario confirmó «Reglas publicadas». La interfaz local ahora incorpora Firebase
Auth y lectura explícita de membresía/workspace desde servidor. El usuario mostró
acceso real como administrador y como vendedor mediante capturas separadas;
falta publicar el frontend. Catálogo y ventas NO
se sincronizan; IndexedDB y los repositorios existentes permanecen intactos.

## Probar el acceso real (administrador y vendedor confirmados)

Abrir Inventario → Datos y respaldos → Conexión a la nube en el servidor local.
Introducir personalmente correo/contraseña de la cuenta ya creada y pulsar Iniciar
sesión; después Verificar acceso. Debe mostrar MATU ART y el rol correspondiente.
No compartir la contraseña en el chat. Repetir con vendedor y cerrar sesión.
La lectura utiliza `getDocFromServer` y fuerza refresco del token; no interpreta
la caché como autorización. No hay consultas comerciales ni escrituras Firestore.

Variables públicas necesarias: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_WORKSPACE_ID`.
Se preparó `.env.local` ignorado por Git con la configuración pública facilitada.
GitHub Actions toma estas variables del repositorio (`vars`); hay que configurarlas
antes de publicar. Ausencia total deshabilita Firebase; configuración parcial muestra
error. No se publican contraseñas, secretos de servidor ni cuentas de servicio.

El usuario confirmó «variables listas» para las cinco variables de repositorio.
No se verificaron todavía por API: `gh` no está disponible en PATH en esta sesión.
El workflow local ya las utiliza, pero sus cambios aún no se han subido a GitHub.
Antes de ejecutar Actions hay que subir el frontend y workflow nuevos. La petición
de migración indicó «No publiques cambios de producción»; queda pendiente autorizar
esta publicación concreta del acceso Firebase, sin sincronización comercial.

El SDK conserva Auth en sessionStorage por pestaña, no localStorage/IndexedDB.
Firestore usa caché de memoria, sin cola persistente adicional. Cerrar sesión no
limpia la base local. Las credenciales son accesibles a JavaScript como en cualquier
Auth web SDK: prevención de XSS sigue siendo necesaria. El estado visual indica
última verificación, no un permiso irrevocable; Rules valida cada solicitud.
No hay registro público en la UI. Crear una cuenta Auth externa no otorga membresía.
Documentación oficial: https://firebase.google.com/docs/auth/web/auth-state-persistence
y https://firebase.google.com/docs/firestore/manage-data/enable-offline.

El componente anterior se conserva como `LegacyCloudConnection.tsx` sin uso en la
UI. No se borraron backend Cloudflare, D1 ni Apps Script. No migración IndexedDB.

## Verificaciones de integración local

- 274/274 pruebas de aplicación, incluidas validación de membresía y errores.
- 9/9 casos en emuladores Auth/Firestore: credenciales válidas/incorrectas, cierre,
  token invalidado tras borrar la cuenta de prueba y las ocho pruebas de Rules.
- Lint sin advertencias; build Pages correcto (19 recursos, advertencia de tamaño
  de chunks, incluido Firebase cargado al abrir el modal).
- Navegador local: Inventario → Datos y respaldos → Conexión a la nube muestra
  campos correo, contraseña e Iniciar sesión sin error de configuración.
- Captura del usuario: cuenta real administradora, MATU ART y acceso verificado con Firestore.
- Segunda captura del usuario (03-11-2026): cuenta vendedora, MATU ART · Vendedor
  y acceso verificado con Firestore. Evidencia aportada por el usuario, no prueba
  automatizada ni verificación de escrituras comerciales. El flujo solicitado
  incluía cerrar la sesión anterior; no se observó directamente ese paso intermedio.
- El usuario confirmó «funciona» tras recargar la misma pestaña y volver a verificar
  el acceso vendedor sin introducir otra vez la contraseña (03-11-2026).
  No equivale a prueba de cierre completo del navegador.
- El usuario confirmó «funciona» después de cerrar sesión, recargar, comprobar el
  formulario de acceso y conservar el inventario local (03-11-2026). Comprobación
  manual reportada por el usuario; no prueba automatizada.
- Pendiente: cierre de pestaña, sesión
  expirada por tiempo, cuotas/rate limiting real, móvil/Android y desconexión física.
- Las pruebas del emulador no prueban las reglas efectivamente publicadas.

## Publicar las reglas después de probarlas

En Firebase Console → proyecto `matu-art` → Firestore Database → Reglas, sustituir
el contenido por el archivo completo `firestore.rules`, revisar y pulsar Publicar.
No cambiar datos de las colecciones ni activar reglas abiertas de prueba.
Este paso no publica la aplicación ni transmite datos locales.

## Pruebas locales

Ejecutar `npm run test:firebase` (requiere Java y descarga inicial del emulador).
Resultados ejecutados: 8/8 casos Rules; 272/272 pruebas existentes; lint correcto;
build Pages correcto con `MATU_BASE_PATH=/MATU-ART-App-Ventas/` (20 recursos).
El primer intento sin esa variable fue rechazado por la protección del script;
se repitió con la configuración correcta. No se publicó la aplicación.

Se fijó `@grpc/grpc-js` a una versión compatible corregida (`^1.14.7`) mediante
override: eliminó los avisos altos introducidos por el SDK de pruebas. Se repitieron
las 8 pruebas de reglas con éxito. `npm audit` aún informa 17 avisos moderados
(8 en dependencias de producción, cadena ExcelJS); no se aplicó un downgrade
automático con `audit fix --force`. Pendiente revisión separada de dependencias.
En Windows el emulador dejó un proceso Java en 8080 al terminar; se identificó
por su línea de comando `demo-matu-art` y se cerró antes de repetir la suite.

La suite `tests/firebase/rules.test.mjs` requiere el emulador Firestore en
127.0.0.1:8080, usa solamente `demo-matu-art` y no credenciales de producción.
Verifica roles, membresía ausente/deshabilitada/inválida, anonimato, aislamiento,
denegación de listas, escalamiento de permisos y escrituras comerciales.
Las identidades son simuladas: no prueba contraseñas, expiración de sesiones,
configuración remota ni conexión real. La comprobación real administradora anterior
proviene de la captura del usuario, no de esta suite.

El diseño completo y los bloqueos de sincronización comercial siguen documentados
en `firebase-spark-audit.md`. No avanzar a escrituras comerciales por publicar estas reglas.
