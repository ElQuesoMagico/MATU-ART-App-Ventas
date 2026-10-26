# GitHub Pages y conexión segura — decisión 2026-10-21

Decisión confirmada: **Preparar Pages; nube pendiente**. Actualizado 26-10-2026.

Repositorio confirmado: `https://github.com/ElQuesoMagico/MATU-ART-App-Ventas.git`.
Ruta de compilación: `/MATU-ART-App-Ventas/` (respetar mayúsculas).
URL prevista, todavía no publicada: `https://elquesomagico.github.io/MATU-ART-App-Ventas/`.
Git local inicializado en `main`, con ese repositorio como `origin`. El remoto no
tenía referencias al consultarlo. No se ha ejecutado push ni el workflow.
La documentación histórica contiene cifras agregadas del análisis de importación;
el importador contiene correspondencias de nombres revisadas por el usuario.
No confundir la exclusión de los CSV y respaldos con anonimización del código.

## Qué está preparado

El frontend puede compilarse para `https://CUENTA.github.io/REPOSITORIO/` mediante
`MATU_BASE_PATH=/REPOSITORIO/`. Para un repositorio `CUENTA.github.io`, usar `/`.
La navegación usa hash; no requiere redirecciones de rutas en GitHub. El manifiesto
PWA usa rutas relativas, el logo oficial y start_url `./#inicio`. La caché se limita
al scope de esa aplicación y excluye APIs. No se publica backend, archivos de
respaldo ni documentación dentro del artefacto de Pages: solo `dist/`.

El workflow `.github/workflows/pages.yml` es **manual**. No se ejecuta al subir un
commit, no aprovisiona Cloudflare y compila deliberadamente sin conexión cloud.
No se ha ejecutado ni publicado. Para un repositorio público, revisar los archivos
de código que se subirán. `.gitignore` excluye docs/import-sources, artifacts y
respaldos/exportaciones locales; los archivos originales siguen en disco. No usar
`git add -f` para esos directorios. No publicar respaldos/credenciales.

## Límite de autenticación: github.io frente a workers.dev

Son sitios distintos. La sesión actual usa `__Host-matu-session`, HttpOnly, Secure,
SameSite=Strict. CORS no fuerza el envío de cookies; SameSite=None tampoco evita que
el navegador bloquee cookies de terceros. No cambiaremos a None ni almacenaremos
tokens en localStorage/IndexedDB para ocultar este problema.

La conexión directa github.io → workers.dev **no queda habilitada**. La validación
del cliente rechaza orígenes cruzados de producción y el Worker sigue comprobando
Origin exacto, CSRF y roles. No CORS `*`, no ampliación de orígenes automática.

Opciones a decidir antes del despliegue cloud:

1. GitHub Pages bajo dominio propio y proxy `/api/*` en el mismo origen hacia Worker:
   conserva el modelo actual de cookies. Requiere dominio, configuración DNS/TLS,
   verificación de Pages y rutas del proxy. Se debe probar antes de operar.
2. Mantener github.io para uso local y decidir la conexión después (preparado ahora).
3. Si es imprescindible github.io con cloud sin dominio, requiere un flujo de
   autenticación distinto y una revisión específica; no se ha implementado ni
   aprobado un intercambio de tokens, popup o cookies particionadas.

Migrar de localhost a github.io o luego a un dominio propio **cambia IndexedDB**:
no hay traslado automático. Descargar un respaldo antes y usar una incorporación
explícita; no restaurar los datos de prueba en producción. Los proyectos bajo el
mismo `CUENTA.github.io` comparten origen y por tanto pueden acceder a la misma
IndexedDB: usar un perfil/cuenta/origen de confianza y no alojar scripts ajenos.

## Acción manual inicial — preparar el repositorio, sin publicar

Abrir GitHub → New repository. Elegir el nombre definitivo de MATU ART y revisar
visibilidad (Pages gratuito en repositorios públicos; comprobar el plan para privados).
Crear el repositorio vacío, sin cargar respaldos ni secretos. Verificar que su página
muestre `CUENTA/NOMBRE`. Comunicar solo esa URL pública o el nombre; no credenciales.
No ejecutar todavía Actions → Publicar MATU ART: la revisión de archivos y el primer
push deben realizarse antes. Esta carpeta local actualmente no tiene repositorio Git.

Pasos posteriores, en orden (se guiarán uno por uno): revisar archivos a subir;
inicializar/conectar Git sin incluir datos privados; subir código; Settings → Pages →
Build and deployment → GitHub Actions; autorizar el workflow manual y verificar
la URL final, recursos, instalación PWA y recarga offline real.

## Cloudflare y Google: configuración previa sin pagos

No se ha contratado Workers Paid. Mantener scrypt N=16384,r=8,p=5. Workers Free
permite 10 ms CPU por petición, insuficiente como objetivo para este hashing.
Para desplegar el backend actual se necesita decidir Workers Paid, medir CPU y
establecer límites de gasto/uso; un dominio propio es una contratación separada.
No ejecutar compras, deploy ni cambios de permisos sin decisión del responsable.

Se puede preparar sin contratar: cuenta Cloudflare, archivos de configuración,
modelo de D1, hoja vacía dentro de MATU ART/BBDD y proyecto Apps Script vinculado.
No crear D1 duplicada; listar recursos una vez autenticado antes de crear.

Para Google, la próxima acción será crear **MATU ART - Base de datos** dentro de
la carpeta existente, abrir Extensiones → Apps Script y conservar el proyecto
vinculado. Reutilizar Code.gs; todavía es contrato v1 de lectura. No desplegarlo
como si aceptara catálogo v2. No cargar el JSON/Excel de pruebas en la hoja.
Secretos se introducirán en Script Properties y `wrangler secret put`, nunca aquí.

Fuentes verificadas el 21-10-2026:
- [Vite: GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages)
- [MDN: cookies de terceros](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies)
- [Cloudflare: límites de Workers](https://developers.cloudflare.com/workers/platform/limits/)
- [GitHub: dominio propio](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)

## Comprobación reproducible antes de publicar

En PowerShell, para un sitio de proyecto:

```powershell
$env:MATU_BASE_PATH='/MATU-ART-App-Ventas/'
npm run build:pages
Remove-Item Env:MATU_BASE_PATH
```

Usar `/` si el repositorio se llama CUENTA.github.io. El workflow deduce esa ruta
sin modificar el código. `build:pages` obliga a una API vacía aunque exista una
configuración cloud en el entorno, verifica recursos generados y no publica nada.
No usar una ruta de ejemplo como configuración definitiva del repositorio.

En CI, la prueba de CSV real puede omitirse al no existir el archivo privado en
Downloads; el resto de pruebas utiliza fixtures de desarrollo. No añadir los datos
reales al repositorio para evitar esa omisión. Los resultados locales completos
siguen registrándose en artifacts (excluido de Git).

Verificación del 23-10-2026: build:pages correcto para `/` y `/matu-art/`
(17 recursos por compilación); lint correcto, TypeScript backend correcto y
258 pruebas aprobadas, sin omitidas. URL cloud ficticia de comprobación ausente
del bundle final. Logs locales en artifacts/8-2-*-2026-10-23.log. No se repitió
la comprobación visual del 21-10 ni se ejecutó el workflow remoto.
